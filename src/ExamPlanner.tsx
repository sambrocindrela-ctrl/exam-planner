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
type TipusPeriode = "PARCIAL" | "FINAL" | "REAVALUACIÓ";
interface Subject {
  id: string;
  codigo: string;
  siglas: string;
  nivel: string;
}
interface TimeSlot { start: string; end: string; }
interface PeriodMeta {
  id: number;            // únic (1..5)
  tipus: TipusPeriode;   // PARCIAL | FINAL | REAVALUACIÓ
  any: number;           // 2025..2090
  quad: 1 | 2;           // 1 | 2
  startStr: string;      // yyyy-MM-dd
  endStr: string;        // yyyy-MM-dd
}
// Assignacions per període: clau "YYYY-MM-DD|slotIndex" → [subjectId,...]
type AssignedMap = Record<string, string[]>;
type AssignedPerPeriod = Record<number, AssignedMap>;
type SlotsPerPeriod = Record<number, TimeSlot[]>;

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

/* ---------- Droppable cell ---------- */
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
              <div className="text-xs opacity-80">Nivell: {s.nivel}</div>
              {!disabled && onRemoveOne && (
                <button
                  onClick={() => onRemoveOne(s.id)}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full border bg-white shadow text-xs"
                  aria-label="Eliminar"
                  title="Eliminar d’aquesta cel·la"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-gray-400 italic">
          {disabled ? "No disponible" : "Arrossega aquí"}
        </div>
      )}
    </td>
  );
}

/* ---------- Main ---------- */
export default function ExamPlanner() {
  /* Subjects (importables per CSV) */
  const [subjects, setSubjects] = useState<Subject[]>([
    { id: "mat101", codigo: "MAT101", siglas: "CALC I", nivel: "GRAU" },
    { id: "fis201", codigo: "FIS201", siglas: "FIS II", nivel: "GRAU" },
    { id: "prg150", codigo: "PRG150", siglas: "PRG", nivel: "GRAU" },
    { id: "alg300", codigo: "ALG300", siglas: "ALG", nivel: "MÀSTER" },
  ]);

  /* Períodes (pestanyes) */
  const [periods, setPeriods] = useState<PeriodMeta[]>([
    {
      id: 1,
      tipus: "PARCIAL",
      any: new Date().getFullYear() as 2025,
      quad: 1,
      startStr: format(mondayOfWeek(new Date()), "yyyy-MM-dd"),
      endStr: format(fridayOfWeek(new Date()), "yyyy-MM-dd"),
    },
  ]);
  const [activePid, setActivePid] = useState<number>(1);

  /* Franges per període */
  const [slotsPerPeriod, setSlotsPerPeriod] = useState<SlotsPerPeriod>({
    1: [
      { start: "08:00", end: "10:00" },
      { start: "10:30", end: "12:30" },
      { start: "15:00", end: "17:00" },
    ],
  });

  /* Assignacions per període */
  const [assignedPerPeriod, setAssignedPerPeriod] = useState<AssignedPerPeriod>(
    {}
  );

  /* Utilitats */
  const activePeriod = periods.find((p) => p.id === activePid)!;
  const dayLabels = ["Dl/Mon", "Dt/Tu", "Dc/Wed", "Dj/Thu", "Dv/Fri"];
  function isDisabledDay(d: Date, p: PeriodMeta) {
    const sd = parseISO(p.startStr);
    const ed = parseISO(p.endStr);
    return isBefore(d, sd) || isAfter(d, ed);
  }
  function cellKey(dateIso: string, slotIndex: number) {
    return `${dateIso}|${slotIndex}`;
  }

  /* Bloqueig global: una mateixa assignatura no es pot usar dues vegades en cap període */
  const usedIds = useMemo(() => {
    const s = new Set<string>();
    for (const amap of Object.values(assignedPerPeriod)) {
      for (const list of Object.values(amap)) {
        for (const id of list) s.add(id);
      }
    }
    return s;
  }, [assignedPerPeriod]);
  const availableSubjects = useMemo(
    () => subjects.filter((s) => !usedIds.has(s.id)),
    [subjects, usedIds]
  );

  /* Drag & drop */
  function onDragEnd(e: any) {
    const subjectId = e.active?.id as string;
    const dropId = e.over?.id as string | undefined;
    if (!dropId) return;
    if (!dropId.startsWith("cell:")) return;

    // id = cell:periodId:YYYY-MM-DD:slotIndex
    const [, pidStr, dateIso, slotIndexStr] = dropId.split(":");
    const pid = Number(pidStr);
    const period = periods.find((p) => p.id === pid);
    if (!period) return;

    const dayDate = parseISO(dateIso);
    if (isDisabledDay(dayDate, period)) return;

    if (usedIds.has(subjectId)) {
      alert("Aquesta assignatura ja està programada al calendari.");
      return;
    }

    const key = cellKey(dateIso, Number(slotIndexStr));
    setAssignedPerPeriod((prev) => {
      const prevMap = prev[pid] ?? {};
      const list = prevMap[key] ?? [];
      if (list.includes(subjectId)) return prev; // no duplicar dins la mateixa cel·la
      const nextMap: AssignedMap = { ...prevMap, [key]: [...list, subjectId] };
      return { ...prev, [pid]: nextMap };
    });
  }

  function removeOneFromCell(pid: number, dateIso: string, slotIndex: number, subjectId: string) {
    const key = cellKey(dateIso, slotIndex);
    setAssignedPerPeriod((prev) => {
      const prevMap = prev[pid] ?? {};
      const list = prevMap[key] ?? [];
      const next = list.filter((id) => id !== subjectId);
      const copy: AssignedMap = { ...prevMap };
      if (next.length === 0) delete copy[key];
      else copy[key] = next;
      return { ...prev, [pid]: copy };
    });
  }

  /* Gestió períodes */
  function addPeriod() {
    if (periods.length >= 5) { alert("Pots tenir com a màxim 5 períodes."); return; }
    const newId = Math.max(0, ...periods.map(p=>p.id)) + 1;
    const today = new Date();
    const meta: PeriodMeta = {
      id: newId,
      tipus: "PARCIAL",
      any: (today.getFullYear() as any),
      quad: 1,
      startStr: format(mondayOfWeek(today), "yyyy-MM-dd"),
      endStr: format(fridayOfWeek(today), "yyyy-MM-dd"),
    };
    setPeriods([...periods, meta]);
    setSlotsPerPeriod((sp)=> ({...sp, [newId]: [{start:"08:00", end:"10:00"}]}));
    setActivePid(newId);
  }
  function removePeriod(id: number) {
    if (!confirm("Segur que vols eliminar aquest període?")) return;
    setPeriods(periods.filter(p=>p.id!==id));
    setAssignedPerPeriod((ap)=> {
      const c = {...ap}; delete c[id]; return c;
    });
    setSlotsPerPeriod((sp)=> {
      const c = {...sp}; delete c[id]; return c;
    });
    if (activePid === id && periods.length>1) {
      const rest = periods.filter(p=>p.id!==id);
      setActivePid(rest[0].id);
    }
  }

  /* Exportacions */
  function exportJSON() {
    const data = {
      periods,
      slotsPerPeriod,
      assignedPerPeriod,
      subjects,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "planificador-examens.json"; a.click();
    URL.revokeObjectURL(url);
  }
  function importJSON(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (Array.isArray(data.periods)) setPeriods(data.periods);
        if (data.slotsPerPeriod) setSlotsPerPeriod(data.slotsPerPeriod);
        if (data.assignedPerPeriod) setAssignedPerPeriod(data.assignedPerPeriod);
        if (Array.isArray(data.subjects)) setSubjects(data.subjects);
        // actiu al primer període si cal
        if (Array.isArray(data.periods) && data.periods.length) {
          setActivePid(data.periods[0].id);
        }
      } catch { alert("JSON no vàlid"); }
    };
    reader.readAsText(f);
    ev.currentTarget.value = "";
  }

  function exportCSV() {
    // Capsa: PeriodeLabel, Date, SlotStart, SlotEnd, Codigo, Siglas, Nivel
    const rows: string[] = [];
    rows.push("Periode,Data,Slot,HoraInici,HoraFi,Codigo,Siglas,Nivel");
    for (const p of periods) {
      const slots = slotsPerPeriod[p.id] ?? [];
      const amap = assignedPerPeriod[p.id] ?? {};
      for (const {mon, fri} of eachWeek(mondayOfWeek(parseISO(p.startStr)), fridayOfWeek(parseISO(p.endStr)))) {
        for (let si=0; si<slots.length; si++) {
          for (let i=0;i<5;i++) {
            const day = addDays(mon, i);
            if (isDisabledDay(day, p)) continue;
            const dateIso = format(day, "yyyy-MM-dd");
            const key = cellKey(dateIso, si);
            const ids = amap[key] ?? [];
            ids.forEach(id => {
              const s = subjects.find(x=>x.id===id);
              if (!s) return;
              const label = `${p.tipus} ${p.any} Q${p.quad}`;
              rows.push([
                label,
                format(day,"dd/MM/yyyy"),
                `${si+1}`,
                slots[si]?.start ?? "",
                slots[si]?.end ?? "",
                s.codigo, s.siglas, s.nivel
              ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(","));
            });
          }
        }
      }
    }
    const blob = new Blob([rows.join("\n")], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download="examenes.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // Ajusta aquí si vols el PRISMA exacte: amplades, ordre i padding.
  function formatTxtLine(
    label: string, dateStr: string, slotIdx: number, start: string, end: string, s: Subject
  ) {
    // Exemple simple amb padding; adapta a l’especificació PRISMA si cal:
    const pad = (t: string, w: number) => (t || "").slice(0,w).padEnd(w," ");
    return (
      pad(label, 20) +
      pad(dateStr, 10) +      // dd/MM/yyyy
      pad(String(slotIdx), 2) +
      pad(start, 5) +
      pad(end, 5) +
      pad(s.codigo, 12) +
      pad(s.siglas, 12) +
      pad(s.nivel, 10)
    );
  }

  function exportTXT() {
    const lines: string[] = [];
    lines.push("EXAMENS_EXPORT"); // capçalera simple
    for (const p of periods) {
      const slots = slotsPerPeriod[p.id] ?? [];
      const amap = assignedPerPeriod[p.id] ?? {};
      const label = `${p.tipus} ${p.any} Q${p.quad}`;
      for (const {mon, fri} of eachWeek(mondayOfWeek(parseISO(p.startStr)), fridayOfWeek(parseISO(p.endStr)))) {
        for (let si=0; si<slots.length; si++) {
          for (let i=0;i<5;i++) {
            const day = addDays(mon, i);
            if (isDisabledDay(day, p)) continue;
            const dateIso = format(day, "yyyy-MM-dd");
            const key = cellKey(dateIso, si);
            const ids = amap[key] ?? [];
            ids.forEach(id => {
              const subj = subjects.find(x=>x.id===id);
              if (!subj) return;
              lines.push(
                formatTxtLine(label, format(day,"dd/MM/yyyy"), si+1, slots[si]?.start ?? "", slots[si]?.end ?? "", subj)
              );
            });
          }
        }
      }
    }
    const blob = new Blob([lines.join("\n")], {type:"text/plain;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download="examenes.txt"; a.click();
    URL.revokeObjectURL(url);
  }

  /* (Opcional) Arrencar amb preset/data via querystring, com abans */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const preset = params.get("preset");
    if (preset) {
      fetch(preset)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (!json) return;
          try {
            if (Array.isArray(json.periods)) setPeriods(json.periods);
            if (json.slotsPerPeriod) setSlotsPerPeriod(json.slotsPerPeriod);
            if (json.assignedPerPeriod) setAssignedPerPeriod(json.assignedPerPeriod);
            if (Array.isArray(json.subjects)) setSubjects(json.subjects);
            if (Array.isArray(json.periods) && json.periods.length) setActivePid(json.periods[0].id);
          } catch {}
        })
        .catch(() => {});
      return;
    }
    const data = params.get("data");
    if (data) {
      try {
        const json = JSON.parse(decodeURIComponent(escape(atob(data))));
        if (Array.isArray(json.periods)) setPeriods(json.periods);
        if (json.slotsPerPeriod) setSlotsPerPeriod(json.slotsPerPeriod);
        if (json.assignedPerPeriod) setAssignedPerPeriod(json.assignedPerPeriod);
        if (Array.isArray(json.subjects)) setSubjects(json.subjects);
        if (Array.isArray(json.periods) && json.periods.length) setActivePid(json.periods[0].id);
      } catch {}
    }
  }, []);

  /* ---------- Render ---------- */
  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <h1 className="text-2xl font-bold mb-2">Planificador d'exàmens (drag & drop) — Períodes</h1>
      <p className="text-sm mb-6">
        Defineix fins a 5 períodes (tipus, any i quadrimestre), cadascun amb dates i franges horàries pròpies.
        Les assignatures programades desapareixen de la safata per evitar duplicats globals.
      </p>

      {/* Barra d'accions global (abans de les pestanyes) */}
      <div className="p-4 rounded-2xl border shadow-sm bg-white mb-6">
        <h2 className="font-semibold mb-3">Dades i intercanvi</h2>
        <div className="flex flex-wrap gap-3 items-center">
          {/* Import CSV assignatures */}
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
                          r.codigo || r.CODIGO || r.Codi || r["CODI UPC"] || r.codi || r.CODI;
                        const siglas =
                          r.siglas || r.SIGLAS || r.sigles || r["sigles"] || r.SIGLES;
                        const nivel =
                          r.nivel || r.NIVEL || r.nivell || r.NIVELL || r.level || r.LEVEL;
                        if (!codigo && !siglas) continue;
                        out.push({
                          id: String(codigo || siglas),
                          codigo: String(codigo || ""),
                          siglas: String(siglas || ""),
                          nivel: String(nivel || ""),
                        });
                      }
                      if (!out.length) { alert("CSV sense files vàlides."); return; }
                      // Evita IDs duplicats fent-los únics
                      const seen = new Set<string>();
                      const unique = out.map((s) => {
                        let id = s.id;
                        while (seen.has(id)) id = id + "-" + Math.random().toString(36).slice(2,5);
                        seen.add(id);
                        return { ...s, id };
                      });
                      setSubjects(unique);
                      alert(`Importades ${unique.length} assignatures del CSV.`);
                    } catch { alert("Error processant el CSV"); }
                  },
                });
                (e.currentTarget as HTMLInputElement).value = "";
              }}
            />
          </label>

          {/* Exportacions */}
          <button onClick={exportCSV} className="px-3 py-2 border rounded-xl shadow-sm">Exportar CSV</button>
          <button onClick={exportTXT} className="px-3 py-2 border rounded-xl shadow-sm">Exportar TXT</button>
          <button onClick={exportJSON} className="px-3 py-2 border rounded-xl shadow-sm">Exportar JSON</button>
          <label className="px-3 py-2 border rounded-xl shadow-sm cursor-pointer bg-white">
            Importar JSON
            <input type="file" accept="application/json" className="hidden" onChange={importJSON} />
          </label>

          <span className="text-xs text-gray-500 ml-auto">
            Disponibles: {availableSubjects.length}/{subjects.length}
          </span>
        </div>
      </div>

      {/* Pestanyes de períodes */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {periods.map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePid(p.id)}
              className={`px-3 py-2 rounded-xl border shadow-sm ${
                p.id === activePid ? "bg-indigo-50 border-indigo-300" : "bg-white"
              }`}
              title="Canviar de període"
            >
              {p.tipus} {p.any} Q{p.quad}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={addPeriod} className="px-3 py-2 border rounded-xl shadow-sm">Afegir període</button>
          {periods.length > 1 && (
            <button onClick={()=>removePeriod(activePid)} className="px-3 py-2 border rounded-xl shadow-sm">
              Eliminar període actiu
            </button>
          )}
        </div>
      </div>

      {/* Config del període actiu */}
      {activePeriod && (
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 rounded-2xl border shadow-sm bg-white">
            <h2 className="font-semibold mb-3">Configuració del període</h2>

            <label className="block text-sm mb-1">Tipus</label>
            <select
              value={activePeriod.tipus}
              onChange={(e) => {
                const v = e.target.value as TipusPeriode;
                setPeriods(periods.map(p => p.id===activePid? {...p, tipus: v}: p));
              }}
              className="w-full border rounded-xl p-2"
            >
              <option>PARCIAL</option>
              <option>FINAL</option>
              <option>REAVALUACIÓ</option>
            </select>

            <label className="block text-sm mt-3 mb-1">Any</label>
            <select
              value={activePeriod.any}
              onChange={(e) => {
                const v = Number(e.target.value);
                setPeriods(periods.map(p => p.id===activePid? {...p, any: v}: p));
              }}
              className="w-full border rounded-xl p-2"
            >
              {Array.from({length: 2090-2025+1}, (_,i)=>2025+i).map(y=>(
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            <label className="block text-sm mt-3 mb-1">Quadrimestre</label>
            <select
              value={activePeriod.quad}
              onChange={(e) => {
                const v = Number(e.target.value) as 1|2;
                setPeriods(periods.map(p => p.id===activePid? {...p, quad: v}: p));
              }}
              className="w-full border rounded-xl p-2"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>

            <label className="block text-sm mt-3 mb-1">Inici</label>
            <input
              type="date"
              value={activePeriod.startStr}
              onChange={(e)=> setPeriods(periods.map(p => p.id===activePid? {...p, startStr: e.target.value}: p))}
              className="w-full border rounded-xl p-2"
            />
            <label className="block text-sm mt-3 mb-1">Fi</label>
            <input
              type="date"
              value={activePeriod.endStr}
              onChange={(e)=> setPeriods(periods.map(p => p.id===activePid? {...p, endStr: e.target.value}: p))}
              className="w-full border rounded-xl p-2"
            />
          </div>

          <div className="p-4 rounded-2xl border shadow-sm bg-white md:col-span-2">
            <h2 className="font-semibold mb-3">Franges horàries (per a aquest període)</h2>
            <div className="space-y-2">
              {(slotsPerPeriod[activePid] ?? []).map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm w-6">{i+1}.</span>
                  <input
                    value={s.start}
                    onChange={(e)=>{
                      const v=e.target.value;
                      setSlotsPerPeriod(sp => {
                        const arr = [...(sp[activePid] ?? [])];
                        arr[i] = {...arr[i], start: v};
                        return {...sp, [activePid]: arr};
                      });
                    }}
                    className="border rounded-xl p-2 w-28"
                    placeholder="HH:mm"
                  />
                  <span>–</span>
                  <input
                    value={s.end}
                    onChange={(e)=>{
                      const v=e.target.value;
                      setSlotsPerPeriod(sp => {
                        const arr = [...(sp[activePid] ?? [])];
                        arr[i] = {...arr[i], end: v};
                        return {...sp, [activePid]: arr};
                      });
                    }}
                    className="border rounded-xl p-2 w-28"
                    placeholder="HH:mm"
                  />
                  <button
                    onClick={()=>{
                      setSlotsPerPeriod(sp=>{
                        const arr=[...(sp[activePid]??[])].filter((_,idx)=> idx!==i);
                        return {...sp, [activePid]: arr};
                      });
                      // Netejar assignacions d’aquesta franja
                      setAssignedPerPeriod(ap=>{
                        const amap = {...(ap[activePid] ?? {})};
                        for (const k of Object.keys(amap)) {
                          const slotIdx = Number(k.split("|")[1]);
                          if (slotIdx === i) delete amap[k];
                        }
                        // Reindexació opcional: es pot ometre per simplicitat
                        return {...ap, [activePid]: amap};
                      });
                    }}
                    className="ml-2 text-xs px-2 py-1 border rounded-lg"
                  >
                    Eliminar
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={()=>{
                setSlotsPerPeriod(sp=>{
                  const cur = sp[activePid] ?? [];
                  const last = cur[cur.length-1];
                  const nextStart = last? last.end : "08:00";
                  const [h,m] = nextStart.split(":").map(Number);
                  const endH = (h+2).toString().padStart(2,"0");
                  const next = { start: nextStart, end: `${endH}:${(m||0).toString().padStart(2,"0")}` };
                  return {...sp, [activePid]: [...cur, next]};
                });
              }}
              className="mt-3 px-3 py-2 border rounded-xl shadow-sm"
            >
              Afegir franja
            </button>
          </div>
        </div>
      )}

      {/* Calaix d'assignatures (comú) */}
      <div className="p-4 rounded-2xl border shadow-sm bg-white mb-6">
        <h2 className="font-semibold mb-3">Assignatures (arrossega)</h2>
        <div className="flex flex-wrap gap-2">
          {availableSubjects.map((s) => (
            <Chip key={s.id} id={s.id} label={`${s.siglas} · ${s.codigo} · ${s.nivel}`} />
          ))}
          {availableSubjects.length === 0 && (
            <div className="text-xs text-gray-500 italic">No queden assignatures per programar.</div>
          )}
        </div>
      </div>

      {/* Calendari del període actiu */}
      <DndContext onDragEnd={onDragEnd} modifiers={[restrictToWindowEdges]}>
        {activePeriod && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-lg font-semibold">
                {activePeriod.tipus} {activePeriod.any} Q{activePeriod.quad} — {format(parseISO(activePeriod.startStr), "dd/MM")} a {format(parseISO(activePeriod.endStr), "dd/MM")}
              </h3>
              <span className="text-sm text-gray-500">(dl–dv)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border p-2 w-[160px] text-left">franja horària/Time slot</th>
                    {Array.from({length:5}).map((_,i)=>{
                      const day = addDays(mondayOfWeek(parseISO(activePeriod.startStr)), i);
                      return (
                        <th key={i} className="border p-2 min-w-[170px] text-left">
                          <div className="font-semibold">{dayLabels[i]}</div>
                          {/* Mostrem la data real de cada setmana a la taula del cos */}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {(slotsPerPeriod[activePid] ?? []).map((s, slotIndex) => (
                    <tr key={slotIndex}>
                      <td className="border p-2 align-top font-medium whitespace-nowrap">{s.start}-{s.end}</td>
                      {Array.from({length:5}).map((_,i)=>{
                        // La capçalera és fixa (Dl..Dv). Les dates exactes es calculen per setmana, a sota.
                        return <td key={i} className="border p-2 text-xs text-gray-400">Vegeu les setmanes</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Taules per setmana dins del període actiu */}
            {[...eachWeek(mondayOfWeek(parseISO(activePeriod.startStr)), fridayOfWeek(parseISO(activePeriod.endStr)))].map(({mon, fri}, wIdx) => (
              <div key={wIdx} className="mt-6">
                <div className="flex items-center gap-3 mb-2">
                  <h4 className="font-semibold">Setmana {format(mon,"dd/MM")} — {format(fri,"dd/MM")}</h4>
                  <span className="text-xs text-gray-500">(dl–dv)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="border p-2 w-[160px] text-left">franja horària/Time slot</th>
                        {Array.from({length:5}).map((_,i)=>{
                          const day = addDays(mon, i);
                          return (
                            <th key={i} className="border p-2 min-w-[170px] text-left">
                              <div className="font-semibold">{dayLabels[i]}</div>
                              <div className="text-xs text-gray-500">{fmtDM(day)}</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {(slotsPerPeriod[activePid] ?? []).map((s, slotIndex) => (
                        <tr key={slotIndex}>
                          <td className="border p-2 align-top font-medium whitespace-nowrap">{s.start}-{s.end}</td>
                          {Array.from({length:5}).map((_,i)=>{
                            const day = addDays(mon, i);
                            const dateIso = format(day, "yyyy-MM-dd");
                            const disabled = isDisabledDay(day, activePeriod);
                            const amap = assignedPerPeriod[activePid] ?? {};
                            const key = cellKey(dateIso, slotIndex);
                            const subjIds = amap[key] ?? [];
                            const assignedList = subjIds
                              .map((id) => subjects.find((x) => x.id === id))
                              .filter(Boolean) as Subject[];
                            return (
                              <DropCell
                                key={i}
                                id={`cell:${activePid}:${dateIso}:${slotIndex}`}
                                disabled={disabled}
                                assignedList={assignedList}
                                onRemoveOne={(subjectId)=> removeOneFromCell(activePid, dateIso, slotIndex, subjectId)}
                              />
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </DndContext>

      <div className="mt-8 text-xs text-gray-500">
        <ul className="list-disc ml-5 space-y-1">
          <li>Fins a 5 períodes amb pestanyes; cada període té les seves franges i dates.</li>
          <li>Es poden programar múltiples assignatures a una mateixa cel·la, però cada assignatura només un cop a tot el conjunt de períodes.</li>
          <li>Exporta CSV/TXT (llistat d’exàmens) i JSON (estat complet) des de la barra superior.</li>
        </ul>
      </div>
    </div>
  );
}
