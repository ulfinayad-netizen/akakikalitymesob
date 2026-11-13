import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "employees-seed.json");
const OUT = [
  join(__dirname, "hr-roster.json"),
  join(__dirname, "..", "..", "chat-server", "scripts", "hr-roster.json")
];
const HR_TO_REPORT = {
  "construction permit": "construction_permit",
  "dars": "federal_docs",
  "ethio post": "ethio_post",
  "land registration": "land_registration",
  "plan & development": "plan_dev",
  "civil registration": "civil_registration",
  "revenue": "revenues",
  "driver & vehicle licensing": "driver_vehicle",
  "health": "health",
  "housing development corp.": "housing_corp",
  "trade": "trade",
  "siket bank": "siket_bank",
  "ethio telecom": "ethiotelecom",
  "labor & skills": "labor_skills",
  "commercial bank of ethiopia": "cbe",
  "land bureau": "land_dev"
};
const COORDINATORS = new Set(["wendesen tenkr", "ulfina yadesa"]);
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const letters = (s) => s.normalize("NFKD").replace(/[^a-zA-Z]/g, "");
const employees = JSON.parse(readFileSync(SRC, "utf-8"));
const taken = new Set();
const roster = employees.map((e) => {
  const parts = e.name.trim().split(/\s+/).map(letters).filter(Boolean);
  const first = titleCase(parts[0] || "User");
  const initial = parts[1] ? parts[1][0].toUpperCase() : "";
  const base = first + initial;
  let username = base;
  let n = 2;
  while (taken.has(username.toLowerCase())) username = `${base}${n++}`;
  taken.add(username.toLowerCase());
  const matched = HR_TO_REPORT[(e.department || "").trim().toLowerCase()];
  return {
    name: e.name.trim().split(/\s+/).map(titleCase).join(" "),
    department: e.department || "",
    username,
    reportDepartments: matched ? [matched] : "all",
    ...COORDINATORS.has(e.name.trim().toLowerCase()) ? { role: "coordinator" } : {}
  };
});
for (const file of OUT) writeFileSync(file, JSON.stringify(roster, null, 2) + "\n", "utf-8");
const matchedCount = roster.filter((r) => r.reportDepartments !== "all").length;
console.log(`Wrote ${roster.length} people to:
  ${OUT.join("\n  ")}`);
console.log(`${matchedCount} matched to one Report department, ${roster.length - matchedCount} get all departments.`);
