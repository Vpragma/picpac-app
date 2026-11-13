// Презентация (ночь 2): кадры ролика (JPEG/PNG) + длительности → MP4 (H.264) системным AVFoundation — без ffmpeg.
// Нужен для Keynote и PowerPoint: webm они не открывают. Вызывается из scripts/present-video.mjs после webm.
//
// Сборка и запуск:
//   swiftc -O scripts/present-mp4.swift -o .night-logs/present-mp4/present-mp4
//   .night-logs/present-mp4/present-mp4 <list.tsv> <out.mp4> <ширина> <высота> [кадр/с]
// list.tsv — строка на кадр: «путь<TAB>длительность в мс». Частота кадров постоянная (по умолчанию 30):
// каждый исходный кадр повторяется столько тиков, сколько он длится; размер округляется до чётного.
// В конце файл открывается заново (AVURLAsset) и печатается его длительность — проверка, что MP4 читается.
import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write(("present-mp4: " + msg + "\n").data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
guard args.count >= 5, let width = Int(args[3]), let height = Int(args[4]), width > 1, height > 1 else {
  fail("использование: present-mp4 <list.tsv> <out.mp4> <ширина> <высота> [кадр/с]")
}
let fps: Int32 = args.count >= 6 ? (Int32(args[5]) ?? 30) : 30
let w = width - width % 2
let h = height - height % 2

guard let listText = try? String(contentsOfFile: args[1], encoding: .utf8) else { fail("нет списка кадров \(args[1])") }
var frames: [(path: String, ms: Double)] = []
for line in listText.split(separator: "\n") {
  let parts = line.split(separator: "\t")
  if parts.count == 2, let ms = Double(parts[1]), ms > 0 { frames.append((String(parts[0]), ms)) }
}
if frames.isEmpty { fail("в списке нет кадров") }

let outURL = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: outURL)
let writer: AVAssetWriter
do {
  writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
} catch {
  fail("AVAssetWriter: \(error.localizedDescription)")
}
let settings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: w,
  AVVideoHeightKey: h,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: max(2_000_000, w * h * 4),
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    AVVideoMaxKeyFrameIntervalKey: Int(fps) * 2,
    AVVideoExpectedSourceFrameRateKey: Int(fps),
  ] as [String: Any],
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
  assetWriterInput: input,
  sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: w,
    kCVPixelBufferHeightKey as String: h,
    kCVPixelBufferCGImageCompatibilityKey as String: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
  ])
guard writer.canAdd(input) else { fail("нельзя добавить видеодорожку \(w)×\(h)") }
writer.add(input)
guard writer.startWriting() else { fail("startWriting: \(writer.error?.localizedDescription ?? "?")") }
writer.startSession(atSourceTime: .zero)

let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
// Кадр → буфер w×h (картинка вписывается целиком в размер ролика)
func pixelBuffer(_ path: String) -> CVPixelBuffer? {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
    let img = CGImageSourceCreateImageAtIndex(src, 0, nil)
  else { return nil }
  var pb: CVPixelBuffer?
  if let pool = adaptor.pixelBufferPool {
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
  } else {
    CVPixelBufferCreate(nil, w, h, kCVPixelFormatType_32BGRA, nil, &pb)
  }
  guard let buf = pb else { return nil }
  CVPixelBufferLockBaseAddress(buf, [])
  defer { CVPixelBufferUnlockBaseAddress(buf, []) }
  guard
    let ctx = CGContext(
      data: CVPixelBufferGetBaseAddress(buf), width: w, height: h, bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(buf), space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
  else { return nil }
  ctx.interpolationQuality = .high
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  return buf
}

var tick: Int64 = 0
var startMs = 0.0
var current: CVPixelBuffer?
var unreadable = 0
for frame in frames {
  let endMs = startMs + frame.ms
  if let b = pixelBuffer(frame.path) { current = b } else { unreadable += 1 }
  if let cur = current {
    while Double(tick) * 1000 / Double(fps) < endMs {
      while !input.isReadyForMoreMediaData { usleep(2000) }
      if !adaptor.append(cur, withPresentationTime: CMTime(value: tick, timescale: fps)) {
        fail("append: \(writer.error?.localizedDescription ?? "?")")
      }
      tick += 1
    }
  }
  startMs = endMs
}
if tick == 0 { fail("ни один кадр не прочитан") }
input.markAsFinished()
writer.endSession(atSourceTime: CMTime(value: tick, timescale: fps))
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
if writer.status != .completed {
  fail("finishWriting: \(writer.error?.localizedDescription ?? "статус \(writer.status.rawValue)")")
}
// Проверка: файл открывается и длительность читается
let duration = CMTimeGetSeconds(AVURLAsset(url: outURL).duration)
if !(duration > 0) { fail("MP4 записан, но длительность не читается") }
print(String(format: "mp4: %@ · %d×%d · %d кадр/с · %lld кадров · %.1f с%@", outURL.path, w, h, fps, tick, duration,
  unreadable > 0 ? " · не прочитано кадров: \(unreadable)" : ""))
