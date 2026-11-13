"use client";
// N7 (C2): кусок редактора не скачался (нет сети, а заранее сохранить его не успели) — вместо «Что-то пошло не так»
// понятный текст или запасной вид (fallback: например, сетка фото без перетаскивания). Остальные ошибки — выше.
import { Component } from "react";
import { isChunkError } from "../../lib/chunkError";

export default class ChunkBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.retry = this.retry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  // С сетью — открыть страницу заново (черновик на устройстве); без сети — попробовать ещё раз из кэша
  retry() {
    if (navigator.onLine) window.location.reload();
    else this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!isChunkError(error)) throw error;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className="card stack" role="status" data-offline-step>
        <p style={{ margin: 0 }}>Без сети этот шаг пока недоступен — откройте его, когда появится связь.</p>
        <p className="small muted" style={{ margin: 0 }}>
          Черновик сохранён на устройстве, остальные шаги работают.
        </p>
        <button type="button" className="btn" onClick={this.retry}>
          Повторить
        </button>
      </div>
    );
  }
}
