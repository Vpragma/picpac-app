# Модели ИИ-редактора (на устройстве)

Все файлы — с нашего сайта, без CDN и Hugging Face в работе приложения (строгая CSP, работа без сети после первого раза).
Сервис-воркер кэширует `/models/` и `/ort/` по первому использованию (не при установке).

| Папка | Что | Откуда | Лицензия |
|---|---|---|---|
| `slimsam-77-uniform-boxes/` | SlimSAM int8: кодировщик 8,9 МБ + декодер 4,8 МБ (выделение касанием) | huggingface.co/ArAnirudh/slimsam-77-uniform-boxes (кодировщик = Xenova/slimsam-77-uniform) | Apache-2.0 |
| `migan/` | MI-GAN `migan_pipeline_v2.onnx` 28 МБ (ластик) | huggingface.co/andraniksargsyan/migan | MIT (код и веса, `LICENSE.txt`) |
| `upscaler/x2/` | esrgan-slim ×2, 0,9 МБ («Резкость для печати») | пакет `@upscalerjs/esrgan-slim` 1.0.0 | MIT |
| `../ort/` | onnxruntime-web 1.31.1 `ort-wasm-simd-threaded.{mjs,wasm}` | пакет `onnxruntime-web` | MIT |
| `nsfw/` | nsfwjs MobileNetV2 224 (`model.json` + `group1-shard1of1`, 2,6 МБ) — первичная проверка фото на устройстве (W-15) | пакет `nsfwjs` 4.3.0, модель GantMan/nsfw_model | MIT |

Контрольные суммы — `~/Documents/hackathon/models-cache/MANIFEST.tsv`. Подробности — `docs/night/research-s03.md`.
