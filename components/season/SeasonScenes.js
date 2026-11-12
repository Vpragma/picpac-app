// Сезонные композиции (N2): линейная графика вокруг фото коллажа баннера и превью в админке.
// viewBox 500×400 = пропорции коллажа 5:4. «back» — под фото (рамки-кальки, ветки), «front» — поверх (листья, кружка).
import { ART_SVG, Bag, FirBranch, Gift, Leaf, Maple, Mug, Oak, Ornament, Plaid, Rowan, Snowflake, Spark, Star, Tag } from "./SeasonArt";

const svgProps = { viewBox: "0 0 500 400", ...ART_SVG, "aria-hidden": true, focusable: "false", preserveAspectRatio: "xMidYMid meet" };
const frame = { strokeWidth: 1.5 };

function AutumnBack() {
  return (
    <>
      <rect x="14" y="44" width="280" height="210" rx="6" className="s3" {...frame} />
      <rect x="334" y="24" width="160" height="214" rx="6" className="s4" {...frame} />
    </>
  );
}

function AutumnFront() {
  return (
    <>
      <Rowan x={-4} y={2} s={1.1} r={-2} />
      <Maple x={300} y={252} s={0.62} r={-18} className="s2" />
      <Oak x={476} y={252} s={0.42} r={24} className="s1" />
      <Mug x={70} y={312} s={0.95} />
      <Plaid x={168} y={350} s={0.82} r={-4} />
      <Leaf x={228} y={296} s={0.8} r={30} className="s5" />
      <Leaf x={20} y={238} s={0.7} r={-60} className="s1" />
    </>
  );
}

function BlackFridayBack() {
  return (
    <>
      <rect x="40" y="56" width="300" height="230" rx="10" className="s3" {...frame} />
      <rect x="160" y="110" width="300" height="230" rx="10" className="s5" {...frame} />
    </>
  );
}

function BlackFridayFront() {
  return (
    <>
      <Tag x={190} y={176} s={2.3} r={-12} />
      <Bag x={378} y={250} s={1.35} r={6} />
      <Spark x={70} y={318} size={14} className="s2" />
      <Spark x={450} y={86} size={18} className="s1" />
      <Spark x={330} y={70} size={9} className="s4" />
      <Spark x={110} y={60} size={8} className="s2" />
    </>
  );
}

function NewYearBack() {
  return (
    <>
      <rect x="14" y="66" width="290" height="218" rx="6" className="s2" {...frame} />
      <rect x="226" y="236" width="250" height="160" rx="6" className="s5" {...frame} />
      <FirBranch x={-4} y={4} s={1.15} r={-2} />
    </>
  );
}

function NewYearFront() {
  return (
    <>
      <Ornament x={292} y={26} s={0.9} drop={34} />
      <Star x={462} y={50} size={20} className="s1" />
      <Snowflake x={404} y={120} size={16} className="s4" />
      <Snowflake x={40} y={330} size={12} className="s2" />
      <Snowflake x={198} y={380} size={9} className="s4" />
      <Gift x={110} y={340} s={0.95} />
    </>
  );
}

const SCENES = {
  autumn: [AutumnBack, AutumnFront],
  blackfriday: [BlackFridayBack, BlackFridayFront],
  newyear: [NewYearBack, NewYearFront],
};

export function SceneLayer({ season, layer = "back", className = "" }) {
  const pair = SCENES[season];
  if (!pair) return null;
  const Layer = layer === "back" ? pair[0] : pair[1];
  return (
    <svg {...svgProps} className={`season-art sb-art sb-art-${layer} ${className}`.trim()}>
      <Layer />
    </svg>
  );
}
