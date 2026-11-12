// Классы нулевого выстрела CLIP для модерации (N4). Текстовые эмбеддинги считаются заранее скриптом
// scripts/moderation-embed.mjs и лежат в public/models/moderation/clip-text.json — на устройстве и на сервере
// нужен только визуальный энкодер. cat — категория находки (lib/moderation.js), null — обычное фото («поглотители»:
// чтобы собака, пляж, флаг или кухонный нож не уходили в опасные категории).
// cat "art" — статуи и картины: не находка, но гасит флаг одного классификатора обнажённости на скульптуре в музее.
// Меняете список — пересчитайте эмбеддинги и пороги (scripts/moderation-eval.mjs).
export const CLIP_CLASSES = [
  // Обнажённость (уточняет вывод классификатора обнажённости словами)
  { id: "breast", cat: "breast", prompts: ["a photo of a topless woman with bare breasts", "a woman with exposed breasts", "bare female breasts and nipples", "a topless woman"] },
  { id: "nude", cat: "nude", prompts: ["a photo of a naked person", "full frontal nudity", "a nude woman without clothes", "a nude man without clothes"] },
  { id: "sex", cat: "sex", prompts: ["a pornographic photo", "people having sex", "an explicit sexual act", "a hardcore porn scene"] },
  // Нацистская и экстремистская символика
  { id: "nazi_flag", cat: "nazi", prompts: ["a nazi flag with a swastika", "a red flag with a black swastika in a white circle", "a swastika symbol", "a black swastika"] },
  { id: "nazi_insignia", cat: "nazi", prompts: ["nazi SS runes insignia", "a nazi eagle holding a swastika", "a nazi armband with a swastika", "an SS totenkopf skull insignia", "nazi party badges"] },
  { id: "nazi_rally", cat: "nazi", prompts: ["a nazi party rally with swastika banners", "nazi soldiers marching with swastika flags", "people doing the nazi salute", "neo-nazis with swastika flags"] },
  // Оружие
  { id: "gun", cat: "weapon", prompts: ["a photo of a gun", "a pistol", "an assault rifle", "a handgun", "a person aiming a gun", "a soldier firing a rifle"] },
  { id: "knife_attack", cat: "weapon", prompts: ["a person threatening someone with a knife", "a combat knife as a weapon", "a machete as a weapon"] },
  // Кровь и насилие
  { id: "blood", cat: "blood", prompts: ["a bloody wound", "a photo with a lot of blood", "a bleeding injured person", "a dead body", "a gory scene"] },
  { id: "violence", cat: "blood", prompts: ["people fighting violently", "a person beating another person", "a violent assault", "violent riot with injured people"] },
  // Наркотики
  { id: "drug_powder", cat: "drugs", prompts: ["lines of cocaine powder", "a bag of white drug powder", "cocaine"] },
  { id: "cannabis", cat: "drugs", prompts: ["marijuana buds", "a cannabis joint", "smoking weed"] },
  { id: "drug_needle", cat: "drugs", prompts: ["a heroin syringe", "drug injection with a needle", "drug paraphernalia"] },
  { id: "drug_pills", cat: "drugs", prompts: ["ecstasy pills", "illegal drug pills with logos"] },
  // Обычные фото (поглотители)
  { id: "swimwear", cat: null, prompts: ["people in swimsuits at the beach", "a woman in a bikini", "a man in swim trunks", "people sunbathing", "kids in a swimming pool"] },
  { id: "lingerie", cat: null, prompts: ["a woman in lingerie", "a fashion photo of a model"] },
  { id: "statue", cat: "art", prompts: ["a marble statue", "a classical sculpture in a museum", "a bronze statue on a pedestal"] },
  { id: "painting", cat: "art", prompts: ["a classical oil painting", "a painting in a museum", "a drawing"] },
  { id: "crowd", cat: null, prompts: ["an old black and white photo of a crowd", "people on a beach in the 1920s", "a crowd of people at a public event", "a busy beach with many people"] },
  { id: "protest", cat: null, prompts: ["a street protest with flags", "a political demonstration", "riot police in a city street"] },
  { id: "dog", cat: null, prompts: ["a photo of a dog", "a puppy", "a dog playing with a ball"] },
  { id: "cat", cat: null, prompts: ["a photo of a cat", "a kitten"] },
  { id: "animal", cat: null, prompts: ["a wild animal", "a bird", "a horse", "a bison", "lions in nature"] },
  { id: "people", cat: null, prompts: ["a portrait of a person", "a family photo", "a group of friends", "a selfie", "an old family photo"] },
  { id: "children", cat: null, prompts: ["children playing", "kids playing football", "a baby", "a mother holding her baby"] },
  { id: "wedding", cat: null, prompts: ["a wedding photo", "a bride and groom"] },
  { id: "landscape", cat: null, prompts: ["a landscape", "a forest", "a lake", "mountains", "a field", "a sunset over the sea"] },
  { id: "city", cat: null, prompts: ["a city street", "a castle", "a building", "a church", "a city at night"] },
  { id: "food", cat: null, prompts: ["food on a plate", "a birthday cake", "a glass of wine", "french fries with ketchup", "cooking in a kitchen", "cutting vegetables with a kitchen knife"] },
  { id: "flowers", cat: null, prompts: ["flowers", "a garden"] },
  { id: "flag", cat: null, prompts: ["a national flag", "a flag waving in the wind", "the flag of a country"] },
  { id: "sport", cat: null, prompts: ["a sports game", "people running a marathon", "a football match"] },
  { id: "document", cat: null, prompts: ["a document with text", "a table with numbers", "a screenshot", "a page of a book"] },
  { id: "toy", cat: null, prompts: ["a colorful plastic toy", "a toy water gun", "children's toys"] },
  { id: "holiday", cat: null, prompts: ["christmas decorations", "a party", "fireworks", "a birthday party"] },
  { id: "vehicle", cat: null, prompts: ["a car", "a train", "an airplane", "a boat"] },
  { id: "medical", cat: null, prompts: ["a doctor in a hospital", "medicine and vitamins", "a nurse giving a vaccine"] },
  { id: "military", cat: null, prompts: ["a military parade", "soldiers in uniform", "an old photo of a soldier"] },
];
