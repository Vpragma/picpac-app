// «Лицензии и авторы»: библиотеки, модели ИИ, шрифт, материалы заказчика и все фото тестовой галереи.
// Серверная страница без клиентского JS. Фото — из манифеста галереи (сверка — docs/test-photos/sources.md),
// лицензии библиотек и моделей — как в docs/licenses.md.
import Link from "next/link";
import gallery from "@/public/demo-gallery/manifest.json";
import styles from "./licenses.module.css";

export const metadata = {
  title: "Лицензии и авторы — PicPac",
  description: "Библиотеки, модели ИИ, шрифт и фото, которые использует приложение PicPac, — с лицензиями и авторами.",
};

const LICENSE_URL = {
  MIT: "https://opensource.org/license/mit",
  "Apache-2.0": "https://www.apache.org/licenses/LICENSE-2.0",
  "MPL-2.0": "https://www.mozilla.org/MPL/2.0/",
};

const LIBRARIES = [
  { name: "next", what: "фреймворк сайта и сервера", license: "MIT", url: "https://github.com/vercel/next.js" },
  { name: "react", what: "интерфейс", license: "MIT", url: "https://github.com/facebook/react" },
  { name: "@supabase/supabase-js", what: "база данных, вход и хранилище фото", license: "MIT", url: "https://github.com/supabase/supabase-js" },
  { name: "onnxruntime-web", what: "запуск моделей ИИ прямо в браузере", license: "MIT", url: "https://github.com/microsoft/onnxruntime" },
  { name: "@huggingface/tokenizers", what: "разбор фразы на слова для модели «по смыслу»", license: "Apache-2.0", url: "https://github.com/huggingface/tokenizers.js" },
  { name: "@huggingface/transformers", what: "работа с моделью выделения предмета", license: "Apache-2.0", url: "https://github.com/huggingface/transformers.js" },
  { name: "upscaler и @upscalerjs/esrgan-slim", what: "«Резкость для печати»", license: "MIT", url: "https://github.com/thekevinscott/UpscalerJS" },
  { name: "@tensorflow/tfjs", what: "вычисления для резкости и проверки фото", license: "Apache-2.0", url: "https://github.com/tensorflow/tfjs" },
  { name: "nsfwjs", what: "прежняя проверка фото (заменена моделями модерации ниже, пакет ещё установлен)", license: "MIT", url: "https://github.com/infinitered/nsfwjs" },
  { name: "sharp", what: "уменьшение фото для проверки модерации на сервере", license: "Apache-2.0 (libvips — LGPL-3.0)", url: "https://github.com/lovell/sharp" },
  { name: "web-push", what: "push-уведомления", license: "MPL-2.0", url: "https://github.com/web-push-libs/web-push" },
  { name: "qrcode", what: "QR-код «Открыть на телефоне»", license: "MIT", url: "https://github.com/soldair/node-qrcode" },
  { name: "zod", what: "проверка данных в запросах", license: "MIT", url: "https://github.com/colinhacks/zod" },
];

const MODELS = [
  {
    name: "SlimSAM-77",
    what: "Выделение предмета касанием. Работает на устройстве, фото никуда не уходит.",
    license: "Apache-2.0",
    url: "https://huggingface.co/Xenova/slimsam-77-uniform",
    urlText: "Модель на Hugging Face",
  },
  {
    name: "MI-GAN",
    what: "Ластик: убирает лишнее с фото. Работает на устройстве. © 2024 Picsart AI Research.",
    license: "MIT",
    url: "https://github.com/Picsart-AI-Research/MI-GAN",
    urlText: "Проект MI-GAN",
  },
  {
    name: "ESRGAN-slim ×2 (UpscalerJS)",
    what: "«Резкость для печати»: увеличивает маленькие фото. Работает на устройстве.",
    license: "MIT",
    url: "https://github.com/thekevinscott/UpscalerJS",
    urlText: "Проект UpscalerJS",
  },
  {
    name: "Marqo nsfw-image-detection-384 (ViT-tiny)",
    what: "Модерация: находит обнажённость на фото. Работает на устройстве при загрузке и повторно на нашем сервере перед заказом.",
    license: "Apache-2.0",
    url: "https://huggingface.co/Marqo/nsfw-image-detection-384",
    urlText: "Модель на Hugging Face",
  },
  {
    name: "CLIP ViT-B/32 (OpenAI)",
    what: "Модерация: узнаёт нацистскую символику, оружие, кровь и наркотики без дообучения. На устройстве и на нашем сервере.",
    license: "MIT",
    url: "https://huggingface.co/openai/clip-vit-base-patch32",
    urlText: "Модель на Hugging Face",
  },
  {
    name: "rubert-tiny (cointegrated)",
    what: "Понимает просьбу своими словами, если её нет в словаре команд. Работает на устройстве, текст никуда не уходит.",
    license: "MIT",
    url: "https://huggingface.co/cointegrated/rubert-tiny",
    urlText: "Модель на Hugging Face",
  },
  {
    name: "YOLOX-Nano (Megvii)",
    what: "Находит предмет по слову: «убери машину», «размой собаку». Работает на устройстве, фото никуда не уходит.",
    license: "Apache-2.0",
    url: "https://github.com/Megvii-BaseDetection/YOLOX",
    urlText: "Проект YOLOX",
  },
];

const PHOTO_LICENSE_NAME = { "Public domain": "Общественное достояние" };

function sourceName(url) {
  try {
    const host = new URL(url).hostname;
    return host === "commons.wikimedia.org" ? "Wikimedia Commons" : host;
  } catch {
    return "источник";
  }
}

function LicenseLink({ license, url }) {
  const href = url || LICENSE_URL[license];
  const text = PHOTO_LICENSE_NAME[license] || license;
  return href ? <a href={href}>{text}</a> : <span>{text}</span>;
}

export default function LicensesPage() {
  const photos = Array.isArray(gallery?.items) ? gallery.items : [];
  return (
    <div className="narrow stack">
      <h1>Лицензии и авторы</h1>
      <p className="muted">
        PicPac собран на открытых библиотеках и моделях ИИ. Здесь — кто их сделал, на каких условиях мы их используем и чьи фото лежат в тестовой галерее.
      </p>

      <section className={`card ${styles.section}`} id="libraries" aria-labelledby="lic-libs">
        <h2 id="lic-libs">Главные библиотеки</h2>
        <ul className={styles.list}>
          {LIBRARIES.map((l) => (
            <li key={l.name}>
              <p className={styles.name}>{l.name}</p>
              <p className={styles.meta}>{l.what}</p>
              <div className={styles.links}>
                <span>
                  Лицензия: <LicenseLink license={l.license} />
                </span>
                <a href={l.url}>Сайт проекта</a>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={`card ${styles.section}`} id="ai" aria-labelledby="lic-ai">
        <h2 id="lic-ai">Модели ИИ</h2>
        <ul className={styles.list}>
          {MODELS.map((m) => (
            <li key={m.name}>
              <p className={styles.name}>{m.name}</p>
              <p className={styles.meta}>{m.what}</p>
              <div className={styles.links}>
                <span>
                  Лицензия: <LicenseLink license={m.license} />
                </span>
                {m.url && <a href={m.url}>{m.urlText}</a>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className={`card ${styles.section}`} id="font" aria-labelledby="lic-font">
        <h2 id="lic-font">Шрифт</h2>
        <p className={styles.name}>Jost</p>
        <p className={styles.meta}>© The Jost Project Authors, автор Owen Earl.</p>
        <div className={styles.links}>
          <span>
            Лицензия: <a href="https://openfontlicense.org">SIL Open Font License 1.1</a>
          </span>
          <a href="https://fonts.google.com/specimen/Jost">Шрифт на Google Fonts</a>
        </div>
      </section>

      <section className={`card ${styles.section}`} id="illustrations" aria-labelledby="lic-illustrations">
        <h2 id="lic-illustrations">Иллюстрации и графика</h2>
        <p style={{ margin: 0 }}>
          Линейные иллюстрации пустых экранов, онбординга и главной (книга, фото, посылка, телефон с ИИ, доставка), открытка с личным промокодом (книга, ветки, листья), значок сезонной плашки, линейные рамки коллажа и значки
          нарисованы командой PicPac App для этого приложения в линейном стиле брендбука PicPac. Сторонней графики нет. Коллаж на главной собран из
          фото тестовой галереи (авторы и лицензии — ниже).
        </p>
      </section>

      <section className={`card ${styles.section}`} id="photoprint" aria-labelledby="lic-photoprint">
        <h2 id="lic-photoprint">Материалы «Фотопринт»</h2>
        <p style={{ margin: 0 }}>
          Каталог, цены, сроки и способы доставки, фото продуктов, логотип и фирменный стиль PicPac — © ООО «Фотопринт». Используются только в этом прототипе для хакатона.
        </p>
      </section>

      <section className={`card ${styles.section}`} id="payments" aria-labelledby="lic-payments">
        <h2 id="lic-payments">Логотипы оплаты</h2>
        <p style={{ margin: 0 }}>Логотипы платёжных систем — товарные знаки их владельцев. Они показывают, какими способами можно оплатить заказ.</p>
      </section>

      <section className={`card ${styles.section}`} id="photos" aria-labelledby="lic-photos">
        <h2 id="lic-photos">Фото тестовой галереи</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Все {photos.length} фото — с Wikimedia Commons, со свободными лицензиями. Мы уменьшили и сжали каждое фото, а «плохие» версии испортили нарочно, чтобы показать
          проверку фото. Изменённые фото под CC BY-SA распространяются на тех же условиях.
        </p>
        <ul className={styles.list} style={{ marginTop: 12 }}>
          {photos.map((p) => (
            <li key={p.file} className={styles.photo}>
              {/* eslint-disable-next-line @next/next/no-img-element -- маленькие готовые превью галереи, оптимизация не нужна */}
              <img className={styles.thumb} src={`/demo-gallery/${p.thumb}`} alt="" width={76} height={76} loading="lazy" decoding="async" />
              <div>
                <p className={styles.name}>{p.title}</p>
                <p className={styles.meta}>Автор: {p.author}</p>
                {p.modified && <p className={styles.changed}>Изменено: {p.modified}</p>}
                <div className={styles.links}>
                  <span>
                    Лицензия: <LicenseLink license={p.license} url={p.licenseUrl} />
                  </span>
                  {p.source && <a href={p.source}>Оригинал на {sourceName(p.source)}</a>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="muted small" style={{ textAlign: "center" }}>
        Вопросы — в <Link href="/help">Помощи</Link>.
      </p>
    </div>
  );
}
