import { useI18n } from "../../i18n/I18nProvider.jsx";
import { AddIcon, DeleteIcon, FitIcon, RedoIcon, SelectIcon, UndoIcon } from "./icons.jsx";

function ToolButton({ label, active, disabled, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-11 items-center justify-center rounded-lg transition disabled:text-[#6b6b6b] ${active ? "bg-fb-accent-soft text-fb-accent-strong" : "text-[#d4d4d4] hover:bg-fb-surface"}`}
    >
      {children}
    </button>
  );
}

/** Werkzeuge über der Karte; auf dem Handy senkrecht am rechten Rand. */
export default function MapToolbar({ tool, onTool, canUndo, canRedo, onUndo, onRedo, onFit, editable, vertical = false, showDelete = true, showRedo = true, showFit = true }) {
  const { t } = useI18n();
  const divider = <span className={vertical ? "mx-2 h-px bg-[#3a3a3a]" : "mx-1 my-2 w-px bg-[#3a3a3a]"} />;
  return (
    <div role="toolbar" aria-label={t("tripEditor.tools")}
      className={`flex gap-1 rounded-xl border border-fb-border bg-fb-main p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)] ${vertical ? "flex-col" : ""}`}>
      <ToolButton label={t("tripEditor.toolSelect")} active={tool === "select"} disabled={!editable} onClick={() => onTool("select")}><SelectIcon /></ToolButton>
      <ToolButton label={t("tripEditor.toolAdd")} active={tool === "add"} disabled={!editable} onClick={() => onTool("add")}><AddIcon /></ToolButton>
      {showDelete && <ToolButton label={t("tripEditor.toolDelete")} active={tool === "delete"} disabled={!editable} onClick={() => onTool("delete")}><DeleteIcon /></ToolButton>}
      {(showRedo || showFit) && divider}
      <ToolButton label={t("tripEditor.undo")} disabled={!canUndo} onClick={onUndo}><UndoIcon /></ToolButton>
      {showRedo && <ToolButton label={t("tripEditor.redo")} disabled={!canRedo} onClick={onRedo}><RedoIcon /></ToolButton>}
      {showFit && divider}
      {showFit && <ToolButton label={t("tripEditor.fit")} onClick={onFit}><FitIcon /></ToolButton>}
    </div>
  );
}
