"use client";
// Сетка фото с перетаскиванием (мышь и клавиатура) — @dnd-kit. N5: отдельный кусок кода, грузится только когда
// в черновике есть фото (app/editor/page.js, React.lazy); до этого та же сетка без перетаскивания.
import { DndContext, KeyboardSensor, MouseSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { reorderPhoto } from "../../lib/draft";
import PhotoCell from "./PhotoCell";

export default function SortablePhotos({ cells, readOnly }) {
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = cells.map((c) => c.p.id);
  const pos = (id) => ids.indexOf(id) + 1;
  const accessibility = {
    screenReaderInstructions: { draggable: "Чтобы переставить фото, нажмите пробел, двигайте стрелками и нажмите пробел ещё раз. Escape — отмена." },
    announcements: {
      onDragStart: ({ active }) => `Взяли фото ${pos(active.id)}.`,
      onDragOver: ({ active, over }) => (over ? `Фото ${pos(active.id)} над местом ${pos(over.id)}.` : `Фото ${pos(active.id)} вне сетки.`),
      onDragEnd: ({ active, over }) => (over ? `Фото поставлено на место ${pos(over.id)}.` : `Фото ${pos(active.id)} осталось на месте.`),
      onDragCancel: ({ active }) => `Отмена. Фото ${pos(active.id)} осталось на месте.`,
    },
  };
  function onDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    reorderPhoto(ids.indexOf(active.id), ids.indexOf(over.id));
  }
  return (
    <DndContext id="photos-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={accessibility}>
      <SortableContext items={ids} strategy={rectSortingStrategy} disabled={readOnly}>
        <div className="photo-grid">
          {cells.map((c) => (
            <SortablePhoto key={c.p.id} {...c} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortablePhoto(props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: props.p.id, disabled: props.readOnly });
  const style = { transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined, transition };
  return <PhotoCell {...props} cellRef={setNodeRef} style={style} dragging={isDragging} handleRef={setActivatorNodeRef} handleProps={{ ...attributes, ...listeners }} />;
}
