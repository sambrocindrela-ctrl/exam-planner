import React, { useMemo, useState, useEffect } from "react";
import { DndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { restrictToWindowEdges } from "@dnd-kit/modifiers";
import {
  format,
  addDays,
  subDays,
  isBefore,
  isAfter,
  startOfDay,
  parseISO,
} from "date-fns";
import * as Papa from "papaparse";

/* ---------- Helpers ---------- */
function mondayOfWeek(d: Date) {
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = (day + 6) % 7; // 0 if Monday
  return startOfDay(subDays(d, diff));
}
function fridayOfWeek(d: Date) {
  const mon = mondayOfWeek(d);
  return startOfDay(addDays(mon, 4));
}
function* eachWeek(mondayStart: Date, fridayEnd: Date) {
  let cur = new Date(mondayStart);
  while (!isAfter(cur, fridayEnd)) {
    const mon = new Date(cur);
    const fri = addDays(mon, 4);
    yield { mon, fri };
    cur = addDays(mon, 7);
  }
}
function fmtDM(d: Date) {
  return format(d, "dd/MM");
}

/* ---------- Types ---------- */
interface Subject {
  id: string;
  codigo: string;
  siglas: string;
  nivel: string;
}
interface TimeSlot {
  start: string;
  end: string;
}
// ahora: clave de celda -> lista de subjectIds
type AssignedMap = Record<string, string[]>;

/* ---------- Draggable chip ---------- */
function Chip({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-2xl shadow-sm border text-sm cursor-grab active:cursor-grabbing select-none bg-white ${
        isDragging ? "opacity-70" : ""
      }`}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
      title={label}
    >
      <span className="font-medium truncate max-w-[16ch]">{label}</span>
    </div>
  );
}

/* ---------- Droppable cell (admite múltiples asignaturas) ---------- */
function DropCell({
  id,
  disabled,
  assignedList,
  onRemoveOne,
}: {
  id: string;
  disabled?: boolean;
  assignedList?: Subject[];
  onRemoveOne?: (subjectId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <td
      ref={setNodeRef}
      className={`align-top min-w-[170px] h-20 p-2 border ${
        disabled
          ? "bg-gray-100 text-gray-400"
          : isOver
          ? "ring-2 ring-indigo-400"
          : "bg-white"
      }`}
    >
      {assignedList && assignedList.length > 0 ? (
        <div className="space-y-2">
          {assignedList.map((s) => (
            <div
              key={s.id}
              className={`relative p-2 rounded-xl border shadow-sm ${
                disabled ? "opacity-60" : "bg-gray-50"
              }`}
            >
              <div className="text-sm font-semibold leading-tight">
                {s.siglas} · {s.codigo}
              </div>
              <div className="text-xs opacity-80">Nivel: {s.nivel}</div>
              {!disabled && onRemoveOne && (
                <button
                  onClick={() => onRemoveOne(s.id)}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full border bg-white shadow text-xs"
                  aria-label="Eliminar asignación"
                  title="Eliminar de esta celda"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-gray-400 italic">
          {disabled ? "No disponible" : "Arrastra aquí"}
        </div>
      )}
    </td>
  );
}

/* ---------- Main component ---------- */
export default function ExamPlanner() {
  // Asignaturas demo (puedes cargarlas por CSV)
  const [subjects, setSubjects] = useState<Subject[]>([
    { id: "mat101", codigo: "MAT101", siglas: "CALC I", nivel: "GRAU" },
    { id: "fis201", codigo: "FIS201", siglas: "FIS II", nivel: "GRAU" },
    { id: "prg150", codigo: "PRG150", siglas: "PRG", nivel: "GRAU" },
    { id: "alg300", codigo: "ALG300", siglas: "ALG", nivel: "MÀSTER" },
  ]);

  // Fechas y franjas horarias
  const [startStr, setStartStr] = useState<string>(
    format(mondayOfWeek(new Date()), "yyyy-MM-dd")
  );
  const [endStr, setEndStr] = useState<string>(
    format(fridayOfWeek(new Date()), "yyyy-MM-dd")
  );
  const [slots, setSlots] = useState<TimeSlot[]>([
    { start: "08:00", end: "10:00" },
    { start: "10:30", end: "12:30" },
    { start: "15:00", end: "17:00" },
  ]);

  // Map de asignaciones: "YYYY-MM-DD|slotIndex" -> lista de subjectIds
  const [assigned, setAssigned] = useState<AssignedMap>({});

  const startDate = useMemo(() => parseISO(startStr), [startStr]);
  const endDate = useMemo(() => parseISO(endStr), [endStr]);

  const dayLabels = ["Dl/Mon", "Dt/Tu", "Dc/Wed", "Dj/Thu", "Dv/Fri"];

  function cellKey(dayDate: Date, slotIndex: number) {
    return `${format(dayDate, "yyyy-MM-dd")}|${slotIndex}`;
  }
  function isDisabledDay(dayDate: Date) {
    return isBefore(dayDate, startDate) || isAfter(dayDate, endDate);
  }

  // AÑADIR: permitir múltiples por celda (sin duplicar la misma asignatura dentro de la celda)
  function onDragEnd(e: any) {
    const subjectId = e.active?.id as string;
    const dropId = e.over?.id as string | undefined;
    if (!dropId) return;
    if (!dropId.startsWith("cell:")) return;
    const [, dateIso, slotIndexStr] = dropId.split(":");
    const slotIndex = Number(slotIndexStr);
    const dayDate = parseISO(dateIso);
    if (isDisabledDay(dayDate)) return;

    const key = `${dateIso}|${slotIndex}`;
    setAssigned((prev) => {
      const list = prev[key] ?? [];
      if (list.includes(subjectId)) return prev; // evita duplicar la misma asignatura en esta celda
      return { ...prev, [key]: [...list, subjectId] };
    });
  }

  // Eliminar solo UNA asignatura de la celda
  function removeOneFromCell(dateIso: string, slotIndex: number, subjectId: string) {
    const key = `${dateIso}|${slotIndex}`;
    setAssigned((prev) => {
      const list = prev[key] ?? [];
      const next = list.filter((id) => id !== subjectId);
      const copy: AssignedMap = { ...prev };
      if (next.length === 0) delete copy[key];
      else copy[key] = next;
      return copy;
    });
  }

  function addSlot() {
    const last = slots[slots.length - 1];
    const nextStart = last ? last.end : "08:00";
    const [h, m] = nextStart.split(":").map(Number);
    const endH = (h + 2).toString().padStart(2, "0");
    setSlots([
      ...slots,
      { start: nextStart, end: `${endH}:${m.toString().padStart(2, "0")}` },
    ]);
  }

  function exportJSON() {
    const data = { startStr, endStr, slots, subjects, assigned };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "planificador-examens.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (data.startStr) setStartStr(data.startStr);
        if (data.endStr) setEndStr(data.endStr);
        if (Array.isArray(data.slots)) setSlots(data.slots);
        if (Array.isArray(data.subjects)) setSubjects(data.subjects);
        if (data.assigned) setAssigned(data.assigned);
      } catch {
        alert("JSON no válido");
      }
    };
    reader.readAsText(file);
  }

  // (Opcional) Soporte para preset/data vía URL (si lo añadiste antes)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const preset = params.get("preset");
    if (preset) {
      fetch(preset)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (!json) return;
          try {
            if (json.startStr) setStartStr(json.startStr);
            if (json.endStr) setEndStr(json.endStr);
            if (Array.isArray(json.slots)) setSlots(json.slots);
            if (Array.isArray(json.subjects)) setSubjects(json.subjects);
            if (json.assigned) setAssigned(json.assigned);
          } catch {}
        })
        .catch(() => {});
      return;
    }
    const data = params.get("data");
    if (data) {
      try {
        const json = JSON.parse(decodeURIComponent(escape(atob(data))));
        if (json.startStr) setStartStr(json.startStr);
        if (json.endStr) setEndStr(json.endStr);
        if (Array.isArray(json.slots)) setSlots(json.slots);
        if (Array.isArray(json.subjects)) setSubjects(json.subjects);
        if (json.assigned) setAssigned(json.assigned);
      } catch {}
    }
  }, []);

  /* ---------- Render ---------- */
 

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <h1 className="text-2xl font-bold mb-2">Planificador d'exàmens (drag & drop)</h1>
      <p className="text-sm mb-6">
        Define el rang de dates i franjes; comparteix l'enllaç amb responsables
        perquè arrosseguin assignatures a dies i franges. Dies fora del rang es
        mostren en gris i no accepten exàmens. Ara cada cel·la pot contenir
        diverses assignatures alhora.
      </p>

      {/* Configuración */}
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="p-4 rounded-2xl border shadow-sm bg-white">
          <h2 className="font-semibold mb-3">Rang de dies per a exàmens</h2>
          <label className="block text-sm mb-1">Inici</label>
          <input
            type="date"
            value={startStr}
            onChange={(e) => setStartStr(e.target.value)}
            className="w-full border rounded-xl p-2"
          />
          <label className="block text-sm mt-3 mb-1">Fi</label>
          <input
            type="date"
            value={endStr}
            onChange={(e) => setEndStr(e.target.value)}
            className="w-full border rounded-xl p-2"
          />
          <div className="flex gap-3 mt-3">
            <button
              onClick={exportJSON}
              className="px-3 py-2 border rounded-xl shadow-sm"
            >
              Exportar JSON
            </button>
            <label className="px-3 py-2 border rounded-xl shadow-sm cursor-pointer">
              Importar JSON
              <input
                type="file"
                accept="application/json"
                onChange={importJSON}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Franjas horarias */}
        <div className="p-4 rounded-2xl border shadow-sm bg-white md:col-span-2">
          <h2 className="font-semibold mb-3">Franjes horàries</h2>
          <div className="space-y-2">
            {slots.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-sm w-6">{i + 1}.</span>
                <input
                  value={s.start}
                  onChange={(e) =>
                    setSlots(
                      slots.map((x, idx) =>
                        idx === i ? { ...x, start: e.target.value } : x
                      )
                    )
                  }
                  className="border rounded-xl p-2 w-28"
                  placeholder="HH:mm"
                />
                <span>–</span>
                <input
                  value={s.end}
                  onChange={(e) =>
                    setSlots(
                      slots.map((x, idx) =>
                        idx === i ? { ...x, end: e.target.value } : x
                      )
                    )
                  }
                  className="border rounded-xl p-2 w-28"
                  placeholder="HH:mm"
                />
                <button
                  onClick={() =>
                    setSlots(slots.filter((_, idx) => idx !== i))
                  }
                  className="ml-2 text-xs px-2 py-1 border rounded-lg"
                >
                  Eliminar
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addSlot}
            className="mt-3 px-3 py-2 border rounded-xl shadow-sm"
          >
            Añadir franja
          </button>
        </div>
      </div>

      {/* DndContext envuelve chips + calendario */}
      <DndContext onDragEnd={onDragEnd} modifiers={[restrictToWindowEdges]}>
        {/* Asignaturas */}
        <div className="p-4 rounded-2xl border shadow-sm bg-white mb-6">
          <h2 className="font-semibold mb-3">Assignatures (arrossega)</h2>
          <div className="flex flex-wrap gap-2">
            {subjects.map((s) => (
              <Chip
                key={s.id}
                id={s.id}
                label={`${s.siglas} · ${s.codigo} · ${s.nivel}`}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 text-sm">
            <label className="px-3 py-2 border rounded-xl shadow-sm cursor-pointer bg-white">
              Importar CSV d'assignatures
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  Papa.parse(f, {
                    header: true,
                    skipEmptyLines: true,
                    complete: (res: Papa.ParseResult<any>) => {
                      try {
                        const rows = (res.data as any[]).filter(Boolean);
                        const out: Subject[] = [];
                        for (const r of rows) {
                          const codigo =
                            r.codigo ||
                            r.CODIGO ||
                            r.Codi ||
                            r["CODI UPC"] ||
                            r.codi ||
                            r.CODI;
                          const siglas =
                            r.siglas ||
                            r.SIGLAS ||
                            r.sigles ||
                            r["sigles"] ||
                            r.SIGLES;
                          const nivel =
                            r.nivel ||
                            r.NIVEL ||
                            r.nivell ||
                            r.NIVELL ||
                            r.level ||
                            r.LEVEL;
                          if (!codigo && !siglas) continue;
                          out.push({
                            id: String(codigo || siglas),
                            codigo: String(codigo || ""),
                            siglas: String(siglas || ""),
                            nivel: String(nivel || ""),
                          });
                        }
                        if (!out.length) {
                          alert("CSV sense files vàlides.");
                          return;
                        }
                        setSubjects(out);
                        alert(`Importades ${out.length} assignatures del CSV.`);
                      } catch {
                        alert("Error processant el CSV");
                      }
                    },
                  });
                  (e.currentTarget as HTMLInputElement).value = "";
                }}
              />
            </label>
            <div className="text-xs text-gray-500">
              Capçaleres recomanades: <code>codigo,siglas,nivel</code>.
            </div>
          </div>
        </div>

        {/* Calendario */}
        {[...eachWeek(mondayOfWeek(startDate), fridayOfWeek(endDate))].map(
          ({ mon, fri }, wIdx) => (
            <div key={wIdx} className="mb-8">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-lg font-semibold">
                  Setmana {format(mon, "dd/MM")} — {format(fri, "dd/MM")}
                </h3>
                <span className="text-sm text-gray-500">(dl–dv)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border p-2 w-[160px] text-left">
                        franja horària/Time slot
                      </th>
                      {Array.from({ length: 5 }).map((_, i) => {
                        const day = addDays(mon, i);
                        return (
                          <th
                            key={i}
                            className="border p-2 min-w-[170px] text-left"
                          >
                            <div className="font-semibold">{dayLabels[i]}</div>
                            <div className="text-xs text-gray-500">
                              {fmtDM(day)}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map((s, slotIndex) => (
                      <tr key={slotIndex}>
                        <td className="border p-2 align-top font-medium whitespace-nowrap">
                          {s.start}-{s.end}
                        </td>
                        {Array.from({ length: 5 }).map((_, i) => {
                          const day = addDays(mon, i);
                          const dateIso = format(day, "yyyy-MM-dd");
                          const disabled = isDisabledDay(day);
                          const key = `${dateIso}|${slotIndex}`;
                          const subjIds = assigned[key] ?? [];
                          const assignedList = subjIds
                            .map((id) => subjects.find((x) => x.id === id))
                            .filter(Boolean) as Subject[];
                          return (
                            <DropCell
                              key={i}
                              id={`cell:${dateIso}:${slotIndex}`}
                              disabled={disabled}
                              assignedList={assignedList}
                              onRemoveOne={(subjectId) =>
                                removeOneFromCell(dateIso, slotIndex, subjectId)
                              }
                            />
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </DndContext>

      <div className="mt-8 text-xs text-gray-500">
        <ul className="list-disc ml-5 space-y-1">
          <li>
            Arrossega una assignatura a una cel·la disponible per assignar
            l'examen. Pots eliminar cadascuna amb la ✕.
          </li>
          <li>
            Els dies fora del rang definit es mostren en gris i no accepten
            exàmens.
          </li>
          <li>
            Una mateixa cel·la pot contenir múltiples assignatures (exàmens simultanis).
          </li>
          <li>
            Utilitza Exportar/Importar JSON per compartir o guardar
            configuracions i assignacions.
          </li>
        </ul>
      </div>
    </div>
  );
}
