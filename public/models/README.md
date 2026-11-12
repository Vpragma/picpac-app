# Модели ИИ-редактора (на устройстве)

Все файлы — с нашего сайта, без CDN и Hugging Face в работе приложения (строгая CSP, работа без сети после первого раза).
Сервис-воркер кэширует `/models/` и `/ort/` по первому использованию (не при установке). Модели модерации качаются при первой загрузке фото в аккаунт (≈ 112 МБ без сжатия, один раз); в режиме экономии трафика и на мобильном интернете — только классификатор (22 МБ).

| Папка | Что | Откуда | Лицензия |
|---|---|---|---|
| `slimsam-77-uniform-boxes/` | SlimSAM int8: кодировщик 8,9 МБ + декодер 4,8 МБ (выделение касанием) | huggingface.co/ArAnirudh/slimsam-77-uniform-boxes (кодировщик = Xenova/slimsam-77-uniform) | Apache-2.0 |
| `migan/` | MI-GAN `migan_pipeline_v2.onnx` 28 МБ (ластик) | huggingface.co/andraniksargsyan/migan | MIT (код и веса, `LICENSE.txt`) |
| `upscaler/x2/` | esrgan-slim ×2, 0,9 МБ («Резкость для печати») | пакет `@upscalerjs/esrgan-slim` 1.0.0 | MIT |
| `../ort/` | onnxruntime-web 1.31.1 `ort-wasm-simd-threaded.{mjs,wasm}` | пакет `onnxruntime-web` | MIT |
| `yolox-nano/` | YOLOX-Nano `yolox_nano.onnx` 3,7 МБ (поиск предмета словом: «убери машину», «размой собаку»; 80 классов COCO) | github.com/Megvii-BaseDetection/YOLOX, релиз 0.1.1rc0 (официальный ONNX), SHA-256 `c789161e…0b7d` | Apache-2.0 |
| `rubert-tiny/` | rubert-tiny int8 `onnx/model_quantized.onnx` 12 МБ + `tokenizer.json` (команда по смыслу для фраз вне словаря); в граф дописан выход скрытого состояния последнего слоя (`scripts/onnx-add-output.mjs`, веса те же); `intents.json` — векторы наших примеров (`scripts/gen-intents.mjs`) | huggingface.co/onnx-community/rubert-tiny-ONNX ← cointegrated/rubert-tiny | MIT |
| `moderation/` | Модерация (N4), на устройстве и на нашем сервере: `nsfw-384.onnx` — классификатор обнажённости Marqo ViT-tiny 384 (22,4 МБ, fp32); `clip-vision-b32-int8.onnx` — визуальный энкодер CLIP ViT-B/32 int8 (89,1 МБ); `clip-text.json` — готовые текстовые эмбеддинги 39 классов (scripts/moderation-embed.mjs) | huggingface.co/KanariKanaru/nsfw-image-detection-384-onnx (из Marqo/nsfw-image-detection-384), huggingface.co/Xenova/clip-vit-base-patch32 `onnx/vision_model_quantized.onnx` | Apache-2.0, MIT (`LICENSE-*.txt`, `NOTICE-nsfw-384.md`) |
| `nsfw/` | nsfwjs MobileNetV2 224 — прежняя проверка фото (W-15); с N4 не используется, файлы оставлены | пакет `nsfwjs` 4.3.0, модель GantMan/nsfw_model | MIT |

Контрольные суммы — `~/Documents/hackathon/models-cache/MANIFEST.tsv`. Подробности — `docs/night/research-s03.md`.
