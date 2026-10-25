// Strich-Icons des Fahrt-Editors (dekorativ, Beschriftung trägt der Button)
const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
};

export const BackIcon = (props) => <svg {...base} {...props}><path d="M15 18l-6-6 6-6" /></svg>;
export const SelectIcon = (props) => <svg {...base} {...props}><path d="M4 3l7 17 2.5-7.5L21 10z" /></svg>;
export const AddIcon = (props) => <svg {...base} {...props}><circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" /></svg>;
export const DeleteIcon = (props) => <svg {...base} {...props}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
export const UndoIcon = (props) => <svg {...base} {...props}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>;
export const RedoIcon = (props) => <svg {...base} {...props}><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></svg>;
export const FitIcon = (props) => <svg {...base} {...props}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>;
export const CloseIcon = (props) => <svg {...base} {...props}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const SearchIcon = (props) => <svg {...base} {...props}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;
export const HomeIcon = (props) => <svg {...base} {...props}><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></svg>;
export const WarnIcon = (props) => <svg {...base} {...props}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>;
