"use client";
// Сверка сезона с сервером (N2): при загрузке, при возврате на вкладку и раз в 30 секунд (lib/season.js).
import { useEffect } from "react";
import { startSeasonSync } from "@/lib/season";

export default function SeasonSync() {
  useEffect(() => startSeasonSync(), []);
  return null;
}
