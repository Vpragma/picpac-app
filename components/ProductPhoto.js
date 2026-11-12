// Фото продукта, собранное на сервере: next/image через getImageProps + <picture> — без клиентского JS (бюджет главной).
// Размытая заглушка — фоном обёртки (с getImageProps placeholder не работает), непрозрачное фото её перекрывает.
import { getImageProps } from "next/image";
import { preload } from "react-dom";

// eager — фото первого экрана (главное фото продукта, LCP): грузится сразу и с высоким приоритетом (N5);
// early — грузится сразу, приоритет решает браузер (первые карточки каталога: на телефоне они чуть ниже первого экрана,
// а при переходе к #catalog — на виду); остальные — лениво
export default function ProductPhoto({ photo, alt = photo.alt, sizes, eager = false, early = false, className }) {
  const { props } = getImageProps({ src: photo.src, alt, sizes, quality: 75, loading: eager || early ? "eager" : "lazy", fetchPriority: eager ? "high" : undefined });
  // Ссылка <link rel=preload> в <head>: браузер начинает качать фото сразу, не дожидаясь разбора разметки до <img>
  if (eager) preload(props.src, { as: "image", imageSrcSet: props.srcSet, imageSizes: props.sizes, fetchPriority: "high" });
  const blur = photo.src.blurDataURL;
  return (
    <picture className={className} style={blur ? { backgroundImage: `url("${blur}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
      <img {...props} alt={alt} decoding="async" />
    </picture>
  );
}

// Галерея на странице продукта: на телефоне — лента с прокруткой, на компьютере — крупное фото и ряд маленьких
export function ProductGallery({ photos, name }) {
  if (!photos.length) return null;
  return (
    <ul className="product-gallery" aria-label={`Фото: ${name}`} tabIndex={0}>
      {photos.map((ph, i) => (
        <li key={i}>
          <ProductPhoto photo={ph} eager={i === 0} sizes={i === 0 ? "(min-width: 1024px) 40rem, 90vw" : "(min-width: 1024px) 8rem, 90vw"} />
        </li>
      ))}
    </ul>
  );
}
