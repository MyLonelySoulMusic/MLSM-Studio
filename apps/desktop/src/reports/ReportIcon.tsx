const paths = {
  reports: "M3 3h18v18H3z M7 16v-4 M12 16V7 M17 16v-7",
  back: "m14 6-6 6 6 6", plus: "M12 5v14 M5 12h14", upload: "M12 16V3 m-5 5 5-5 5 5 M4 16v5h16v-5",
  download: "M12 3v13 m-5-5 5 5 5-5 M4 17v4h16v-4", save: "M4 3h13l4 4v14H3V3z M7 3v6h9V3 M7 21v-8h10v8",
  folder: "M3 6h7l2 3h9v12H3z", eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  edit: "m15 3 6 6-12 12H3v-6z M12 6l6 6", copy: "M8 8h13v13H8z M16 8V3H3v13h5",
  trash: "M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7", close: "m6 6 12 12 M18 6 6 18",
  bar: "M4 20V10h4v10 M10 20V4h4v16 M16 20v-9h4v9", line: "M3 3v18h18 M6 15l4-5 4 3 6-8",
  area: "M3 21V3 M3 21h18 M6 18v-5l4-5 4 4 6-7v13z", doughnut: "M12 3a9 9 0 1 0 9 9h-6a3 3 0 1 1-3-3z M15 3v6h6a9 9 0 0 0-6-6",
  scatter: "M3 3v18h18 M7 13h1 M12 8h1 M14 14h1 M18 5h1 M18 10h1", table: "M3 4h18v16H3z M3 9h18 M3 14h18 M9 4v16 M15 4v16",
  pivot: "M3 4h18v16H3z M3 9h18 M10 4v16 M15 9v11 M3 15h18 M6 12l-2 2 2 2 M13 6l2-2 2 2",
  text: "M4 5h16 M12 5v15 M8 20h8", kpi: "M3 5h18v14H3z M7 10h3v5H7 M14 13l2-3 2 1",
  filter: "M3 4h18l-7 8v8l-4-2v-6z", up: "m6 15 6-6 6 6", down: "m6 9 6 6 6-6",
  grip: "M8 5h1 M15 5h1 M8 12h1 M15 12h1 M8 19h1 M15 19h1", search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
  reset: "M4 9a8 8 0 1 1 0 7 M4 3v6h6", check: "m4 12 5 5L20 6", file: "M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h5",
  link: "M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1 M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1",
  row: "M3 6h18v12H3z M8 6v12 M16 6v12",
} as const;
export function ReportIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="rpt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
