import type { Aggregation, CellValue, FieldType, ReportDataset, ReportField } from "./types";

export const MLSM_FORMULA_GUIDE = `MLSM Formula is the calculated-field language used by MLSM Reports. Use it to calculate values for individual rows or aggregated groups.

FIELDS AND LITERALS
- Reference a dataset field with square brackets: [Revenue], [Units sold], [Country].
- Numbers use a dot for decimals. Text can use single or double quotes. TRUE, FALSE and NULL are supported.

OPERATORS
- Arithmetic: +, -, *, /, %
- Comparison: =, !=, <>, <, <=, >, >=
- Logic: AND, OR, NOT

ROW FUNCTIONS
- IF(condition, when_true, when_false)
- COALESCE(value, fallback...), NULLIF(value, value_to_null)
- ABS(number), ROUND(number, decimals), FLOOR(number), CEIL(number)
- LOWER(text), UPPER(text), TRIM(text), LEN(text), CONCAT(value, ...)
- YEAR(date), MONTH(date), DAY(date)

AGGREGATE FUNCTIONS
- SUM(expression), AVG(expression), MIN(expression), MAX(expression), MEDIAN(expression)
- COUNT(expression), COUNTD(expression), RANGE(expression), VARIANCE(expression), STDEV(expression)

SEMANTICS
- A formula without aggregate functions is evaluated for every dataset row. A widget then applies its selected aggregation to those row results.
- A formula containing aggregate functions is evaluated directly on every widget group. Example: SUM([Revenue]) / SUM([Units]) is a weighted aggregate ratio and is not SUM([Revenue] / [Units]).
- In the dataset preview, aggregate functions use the current row so that the calculated column remains inspectable: SUM([Revenue]) / SUM([Units]) displays [Revenue] / [Units] for each row.
- Do not mix a bare field with aggregates at the same expression level. Use an aggregate around every field in an aggregate formula.
- Division by zero and invalid operations return NULL.

EXAMPLES
- Row margin: ([Revenue] - [Cost]) / [Revenue]
- Aggregate margin: (SUM([Revenue]) - SUM([Cost])) / SUM([Revenue])
- Distinct customers: COUNTD([Customer ID])
- Conditional aggregate: SUM(IF([Status] = 'Paid', [Revenue], 0))
- Friendly label: IF([Revenue] >= 1000, 'High', 'Standard')`;

export const MLSM_FORMULA_GUIDE_IT = `MLSM Formula è il linguaggio dei campi calcolati di MLSM Reports. Permette di calcolare valori per singole righe o gruppi aggregati.

CAMPI E VALORI
- Racchiudi il nome di un campo tra parentesi quadre: [Ricavi], [Unità vendute], [Paese].
- I decimali usano il punto. Il testo può usare apici singoli o doppi. Sono disponibili TRUE, FALSE e NULL.

OPERATORI
- Aritmetici: +, -, *, /, %
- Confronto: =, !=, <>, <, <=, >, >=
- Logici: AND, OR, NOT

FUNZIONI DI RIGA
- IF(condizione, valore_vero, valore_falso)
- COALESCE(valore, alternativa...), NULLIF(valore, valore_da_annullare)
- ABS(numero), ROUND(numero, decimali), FLOOR(numero), CEIL(numero)
- LOWER(testo), UPPER(testo), TRIM(testo), LEN(testo), CONCAT(valore, ...)
- YEAR(data), MONTH(data), DAY(data)

FUNZIONI AGGREGATE
- SUM(espressione), AVG(espressione), MIN(espressione), MAX(espressione), MEDIAN(espressione)
- COUNT(espressione), COUNTD(espressione), RANGE(espressione), VARIANCE(espressione), STDEV(espressione)

COME VENGONO CALCOLATE
- Senza funzioni aggregate, la formula viene calcolata su ogni riga; il widget applica poi l’aggregazione selezionata.
- Con funzioni aggregate, la formula viene calcolata direttamente per ogni gruppo del widget. SUM([Ricavi]) / SUM([Unità]) è quindi un rapporto ponderato e non la somma dei rapporti di riga.
- Nell’anteprima dati, anche una formula aggregata mostra il corrispondente calcolo della singola riga.
- In una formula aggregata ogni campo deve essere dentro SUM, AVG, COUNTD o un’altra funzione aggregata.
- Divisioni per zero e operazioni non valide restituiscono NULL.

ESEMPI
- Margine di riga: ([Ricavi] - [Costi]) / [Ricavi]
- Margine aggregato: (SUM([Ricavi]) - SUM([Costi])) / SUM([Ricavi])
- Clienti distinti: COUNTD([ID cliente])
- Somma condizionale: SUM(IF([Stato] = 'Pagato', [Ricavi], 0))`;

type Token = { kind: "number" | "string" | "field" | "word" | "operator" | "punct" | "eof"; value: string; position: number };
type Expression =
  | { kind: "literal"; value: CellValue }
  | { kind: "field"; name: string }
  | { kind: "unary"; operator: string; value: Expression }
  | { kind: "binary"; operator: string; left: Expression; right: Expression }
  | { kind: "call"; name: string; args: Expression[] };

const AGGREGATES = new Set(["SUM", "AVG", "COUNT", "COUNTD", "MIN", "MAX", "MEDIAN", "RANGE", "VARIANCE", "STDEV"]);
const FUNCTIONS = new Set([...AGGREGATES, "IF", "COALESCE", "NULLIF", "ABS", "ROUND", "FLOOR", "CEIL", "LOWER", "UPPER", "TRIM", "LEN", "CONCAT", "YEAR", "MONTH", "DAY"]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === "[") {
      const start = index++;
      let value = "";
      while (index < source.length && source[index] !== "]") value += source[index++]!;
      if (source[index] !== "]") throw new Error(`Parentesi quadra non chiusa alla posizione ${start + 1}.`);
      index += 1;
      if (!value.trim()) throw new Error(`Riferimento campo vuoto alla posizione ${start + 1}.`);
      tokens.push({ kind: "field", value: value.trim(), position: start });
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      const start = index++;
      let value = "";
      while (index < source.length) {
        const current = source[index++]!;
        if (current === quote) {
          if (source[index] === quote) { value += quote; index += 1; continue; }
          break;
        }
        if (current === "\\" && index < source.length) value += source[index++]!;
        else value += current;
      }
      if (source[index - 1] !== quote) throw new Error(`Testo non chiuso alla posizione ${start + 1}.`);
      tokens.push({ kind: "string", value, position: start });
      continue;
    }
    if (/\d/.test(char) || (char === "." && /\d/.test(source[index + 1] ?? ""))) {
      const start = index;
      while (/\d/.test(source[index] ?? "")) index += 1;
      if (source[index] === ".") { index += 1; while (/\d/.test(source[index] ?? "")) index += 1; }
      if (/e/i.test(source[index] ?? "")) { index += 1; if (/[+-]/.test(source[index] ?? "")) index += 1; while (/\d/.test(source[index] ?? "")) index += 1; }
      tokens.push({ kind: "number", value: source.slice(start, index), position: start });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      while (/[A-Za-z0-9_]/.test(source[index] ?? "")) index += 1;
      tokens.push({ kind: "word", value: source.slice(start, index).toUpperCase(), position: start });
      continue;
    }
    const double = source.slice(index, index + 2);
    if (["<=", ">=", "!=", "<>"].includes(double)) { tokens.push({ kind: "operator", value: double, position: index }); index += 2; continue; }
    if (["+", "-", "*", "/", "%", "=", "<", ">"].includes(char)) { tokens.push({ kind: "operator", value: char, position: index++ }); continue; }
    if (["(", ")", ","].includes(char)) { tokens.push({ kind: "punct", value: char, position: index++ }); continue; }
    throw new Error(`Carattere “${char}” non supportato alla posizione ${index + 1}.`);
  }
  tokens.push({ kind: "eof", value: "", position: source.length });
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}
  private current(): Token { return this.tokens[this.index]!; }
  private take(value?: string): Token {
    const token = this.current();
    if (value !== undefined && token.value !== value) throw new Error(`Atteso “${value}” alla posizione ${token.position + 1}.`);
    this.index += 1;
    return token;
  }
  parse(): Expression {
    const expression = this.binary(0);
    if (this.current().kind !== "eof") throw new Error(`Elemento inatteso “${this.current().value}” alla posizione ${this.current().position + 1}.`);
    return expression;
  }
  private precedence(token: Token): number {
    if (token.kind === "word" && token.value === "OR") return 1;
    if (token.kind === "word" && token.value === "AND") return 2;
    if (token.kind === "operator" && ["=", "!=", "<>", "<", "<=", ">", ">="].includes(token.value)) return 3;
    if (token.kind === "operator" && ["+", "-"].includes(token.value)) return 4;
    if (token.kind === "operator" && ["*", "/", "%"].includes(token.value)) return 5;
    return 0;
  }
  private binary(minimum: number): Expression {
    let left = this.unary();
    while (true) {
      const token = this.current();
      const precedence = this.precedence(token);
      if (precedence < minimum || precedence === 0) break;
      this.take();
      const right = this.binary(precedence + 1);
      left = { kind: "binary", operator: token.value, left, right };
    }
    return left;
  }
  private unary(): Expression {
    const token = this.current();
    if ((token.kind === "operator" && ["+", "-"].includes(token.value)) || (token.kind === "word" && token.value === "NOT")) {
      this.take(); return { kind: "unary", operator: token.value, value: this.unary() };
    }
    return this.primary();
  }
  private primary(): Expression {
    const token = this.take();
    if (token.kind === "number") return { kind: "literal", value: Number(token.value) };
    if (token.kind === "string") return { kind: "literal", value: token.value };
    if (token.kind === "field") return { kind: "field", name: token.value };
    if (token.kind === "punct" && token.value === "(") { const value = this.binary(0); this.take(")"); return value; }
    if (token.kind === "word") {
      if (token.value === "TRUE") return { kind: "literal", value: true };
      if (token.value === "FALSE") return { kind: "literal", value: false };
      if (token.value === "NULL") return { kind: "literal", value: null };
      if (this.current().value !== "(") throw new Error(`Usa [${token.value}] per riferirti a un campo.`);
      if (!FUNCTIONS.has(token.value)) throw new Error(`Funzione “${token.value}” non supportata.`);
      this.take("(");
      const args: Expression[] = [];
      if (this.current().value !== ")") {
        args.push(this.binary(0));
        while (this.current().value === ",") { this.take(","); args.push(this.binary(0)); }
      }
      this.take(")");
      return { kind: "call", name: token.value, args };
    }
    throw new Error(`Formula incompleta alla posizione ${token.position + 1}.`);
  }
}

function walk(expression: Expression, visit: (value: Expression, insideAggregate: boolean) => void, insideAggregate = false): void {
  visit(expression, insideAggregate);
  if (expression.kind === "unary") walk(expression.value, visit, insideAggregate);
  if (expression.kind === "binary") { walk(expression.left, visit, insideAggregate); walk(expression.right, visit, insideAggregate); }
  if (expression.kind === "call") expression.args.forEach(arg => walk(arg, visit, insideAggregate || AGGREGATES.has(expression.name)));
}

function parseFormula(formula: string): Expression {
  const source = formula.trim();
  if (!source) throw new Error("Inserisci una formula.");
  if (source.length > 4000) throw new Error("La formula supera il limite di 4.000 caratteri.");
  return new Parser(tokenize(source)).parse();
}

function fieldLookup(dataset: ReportDataset): Map<string, ReportField> {
  const lookup = new Map<string, ReportField>();
  for (const field of dataset.fields) {
    const key = field.name.normalize("NFKC").trim().toLocaleLowerCase();
    if (lookup.has(key)) throw new Error(`Il nome campo “${field.name}” è ambiguo. Rinomina una delle colonne nel file sorgente.`);
    lookup.set(key, field);
  }
  return lookup;
}

export interface FormulaAnalysis { aggregate: boolean; referencedFieldIds: string[] }
interface CompiledFormula { expression: Expression; lookup: Map<string, ReportField>; analysis: FormulaAnalysis }
const compiledFormulas = new WeakMap<ReportDataset, Map<string, CompiledFormula>>();

function compileFormula(formula: string, dataset: ReportDataset): CompiledFormula {
  const key = formula.trim();
  const cached = compiledFormulas.get(dataset)?.get(key);
  if (cached) return cached;
  const expression = parseFormula(formula);
  const lookup = fieldLookup(dataset);
  const ids = new Set<string>();
  let aggregate = false;
  let bareFieldInAggregateFormula = false;
  walk(expression, (node, insideAggregate) => {
    if (node.kind === "call" && AGGREGATES.has(node.name)) aggregate = true;
    if (node.kind === "field") {
      const field = lookup.get(node.name.normalize("NFKC").trim().toLocaleLowerCase());
      if (!field) throw new Error(`Il campo [${node.name}] non esiste nell’origine dati.`);
      ids.add(field.id);
      if (!insideAggregate) bareFieldInAggregateFormula = true;
    }
  });
  if (aggregate && bareFieldInAggregateFormula) throw new Error("In una formula aggregata ogni campo deve essere racchiuso in SUM, AVG, COUNTD o un’altra funzione aggregata.");
  const compiled = { expression, lookup, analysis: { aggregate, referencedFieldIds: [...ids] } };
  const entries = compiledFormulas.get(dataset) ?? new Map<string, CompiledFormula>();
  entries.set(key, compiled); compiledFormulas.set(dataset, entries);
  return compiled;
}

export function analyzeCalculatedFormula(formula: string, dataset: ReportDataset): FormulaAnalysis {
  const analysis = compileFormula(formula, dataset).analysis;
  return { aggregate: analysis.aggregate, referencedFieldIds: [...analysis.referencedFieldIds] };
}

interface EvaluationContext { dataset: ReportDataset; rows: ReportDataset["rows"]; row: ReportDataset["rows"][number] | null; rowPreview: boolean; lookup: Map<string, ReportField> }
function numeric(value: CellValue): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function truthy(value: CellValue): boolean { return value !== null && value !== false && value !== 0 && value !== ""; }
function comparable(value: CellValue): string | number | boolean | null { return value; }
function fieldValue(name: string, context: EvaluationContext, row = context.row): CellValue {
  const field = context.lookup.get(name.normalize("NFKC").trim().toLocaleLowerCase());
  if (!field || !row) return null;
  return row[field.id] ?? null;
}
function aggregateValues(name: string, values: CellValue[], rowCount: number): CellValue {
  const present = values.filter(value => value !== null && value !== "");
  if (name === "COUNT") return present.length;
  if (name === "COUNTD") return new Set(present.map(value => `${typeof value}:${String(value)}`)).size;
  const numbers = present.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!numbers.length) return null;
  if (name === "SUM") return numbers.reduce((sum, value) => sum + value, 0);
  if (name === "AVG") return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  if (name === "MIN") return numbers[0]!;
  if (name === "MAX") return numbers.at(-1)!;
  if (name === "MEDIAN") { const middle = Math.floor(numbers.length / 2); return numbers.length % 2 ? numbers[middle]! : (numbers[middle - 1]! + numbers[middle]!) / 2; }
  if (name === "RANGE") return numbers.at(-1)! - numbers[0]!;
  const average = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const variance = numbers.reduce((sum, value) => sum + ((value - average) ** 2), 0) / numbers.length;
  if (name === "VARIANCE") return variance;
  if (name === "STDEV") return Math.sqrt(variance);
  return rowCount;
}

function evaluate(expression: Expression, context: EvaluationContext): CellValue {
  if (expression.kind === "literal") return expression.value;
  if (expression.kind === "field") return fieldValue(expression.name, context);
  if (expression.kind === "unary") {
    const value = evaluate(expression.value, context);
    if (expression.operator === "NOT") return !truthy(value);
    const number = numeric(value); return number === null ? null : expression.operator === "-" ? -number : number;
  }
  if (expression.kind === "binary") {
    if (expression.operator === "AND") return truthy(evaluate(expression.left, context)) && truthy(evaluate(expression.right, context));
    if (expression.operator === "OR") return truthy(evaluate(expression.left, context)) || truthy(evaluate(expression.right, context));
    const left = evaluate(expression.left, context); const right = evaluate(expression.right, context);
    if (["=", "!=", "<>", "<", "<=", ">", ">="].includes(expression.operator)) {
      const a = comparable(left); const b = comparable(right);
      if (expression.operator === "=") return a === b;
      if (expression.operator === "!=" || expression.operator === "<>") return a !== b;
      if (a === null || b === null || typeof a !== typeof b) return false;
      if (expression.operator === "<") return a < b;
      if (expression.operator === "<=") return a <= b;
      if (expression.operator === ">") return a > b;
      return a >= b;
    }
    const a = numeric(left); const b = numeric(right);
    if (a === null || b === null) return null;
    if (expression.operator === "+") return a + b;
    if (expression.operator === "-") return a - b;
    if (expression.operator === "*") return a * b;
    if (expression.operator === "/") return b === 0 ? null : a / b;
    return b === 0 ? null : a % b;
  }
  const args = expression.args;
  if (AGGREGATES.has(expression.name)) {
    if (args.length !== 1) throw new Error(`${expression.name} richiede esattamente un argomento.`);
    const rows = context.rowPreview && context.row ? [context.row] : context.rows;
    return aggregateValues(expression.name, rows.map(row => evaluate(args[0]!, { ...context, row })), rows.length);
  }
  if (expression.name === "IF") {
    if (args.length !== 3) throw new Error("IF richiede condizione, valore vero e valore falso.");
    return evaluate(truthy(evaluate(args[0]!, context)) ? args[1]! : args[2]!, context);
  }
  const values = args.map(arg => evaluate(arg, context));
  if (expression.name === "COALESCE") return values.find(value => value !== null && value !== "") ?? null;
  if (expression.name === "NULLIF") return values.length === 2 && values[0] === values[1] ? null : values[0] ?? null;
  if (expression.name === "CONCAT") return values.map(value => value ?? "").join("");
  if (expression.name === "LOWER") return String(values[0] ?? "").toLocaleLowerCase();
  if (expression.name === "UPPER") return String(values[0] ?? "").toLocaleUpperCase();
  if (expression.name === "TRIM") return String(values[0] ?? "").trim();
  if (expression.name === "LEN") return String(values[0] ?? "").length;
  if (["YEAR", "MONTH", "DAY"].includes(expression.name)) {
    const date = new Date(String(values[0] ?? "")); if (!Number.isFinite(date.getTime())) return null;
    return expression.name === "YEAR" ? date.getUTCFullYear() : expression.name === "MONTH" ? date.getUTCMonth() + 1 : date.getUTCDate();
  }
  const value = numeric(values[0] ?? null); if (value === null) return null;
  if (expression.name === "ABS") return Math.abs(value);
  if (expression.name === "FLOOR") return Math.floor(value);
  if (expression.name === "CEIL") return Math.ceil(value);
  if (expression.name === "ROUND") { const decimals = Math.max(0, Math.min(10, Math.trunc(numeric(values[1] ?? 0) ?? 0))); const factor = 10 ** decimals; return Math.round(value * factor) / factor; }
  return null;
}

function safeCell(value: CellValue): CellValue {
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (typeof value === "string" && value.length > 100_000) throw new Error("Il risultato del campo calcolato supera il limite di 100.000 caratteri per cella.");
  return value;
}

export function evaluateCalculatedFormula(formula: string, dataset: ReportDataset, rows: ReportDataset["rows"], row: ReportDataset["rows"][number] | null, rowPreview = false): CellValue {
  const compiled = compileFormula(formula, dataset);
  return safeCell(evaluate(compiled.expression, { dataset, rows, row, rowPreview, lookup: compiled.lookup }));
}

export function inferCalculatedFieldType(formula: string, dataset: ReportDataset): FieldType {
  const analysis = analyzeCalculatedFormula(formula, dataset);
  const sample = dataset.rows.slice(0, 100).map(row => evaluateCalculatedFormula(formula, dataset, [row], row, true)).find(value => value !== null);
  return typeof sample === "number" || (sample === undefined && analysis.aggregate) ? "number" : typeof sample === "boolean" ? "boolean" : "text";
}

export function materializeCalculatedFields(dataset: ReportDataset): ReportDataset {
  let current: ReportDataset = { ...dataset, fields: dataset.fields.map(field => ({ ...field })), rows: dataset.rows.map(row => ({ ...row })) };
  const calculatedIds = new Set(current.fields.filter(field => field.calculated).map(field => field.id));
  const available = new Set(current.fields.filter(field => !field.calculated).map(field => field.id));
  for (const field of current.fields.filter(field => field.calculated)) {
    const analysis = analyzeCalculatedFormula(field.calculated!.formula, current);
    const unavailable = analysis.referencedFieldIds.find(id => calculatedIds.has(id) && !available.has(id));
    if (unavailable) throw new Error(`Il campo calcolato “${field.name}” contiene un riferimento circolare o a un campo calcolato definito dopo di lui.`);
    current = { ...current, rows: current.rows.map(row => ({ ...row, [field.id]: evaluateCalculatedFormula(field.calculated!.formula, current, [row], row, true) })) };
    available.add(field.id);
  }
  return current;
}

export function createCalculatedField(dataset: ReportDataset, input: { id: string; name: string; formula: string; description?: string }): ReportDataset {
  const name = input.name.trim(); const formula = input.formula.trim();
  if (!name) throw new Error("Assegna un nome al campo calcolato.");
  if (dataset.fields.some(field => field.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error(`Esiste già un campo chiamato “${name}”.`);
  analyzeCalculatedFormula(formula, dataset);
  const field: ReportField = { id: input.id, name, type: inferCalculatedFieldType(formula, dataset), calculated: { formula, description: input.description?.trim() ?? "" } };
  return materializeCalculatedFields({ ...dataset, fields: [...dataset.fields, field], rows: dataset.rows.map(row => ({ ...row, [field.id]: null })) });
}

export function calculatedMeasureValue(dataset: ReportDataset, field: ReportField | undefined, rows: ReportDataset["rows"], aggregation: Aggregation, fallback: (values: (CellValue | undefined)[], count: number, aggregation: Aggregation) => number | null): number | null {
  if (field?.calculated && analyzeCalculatedFormula(field.calculated.formula, dataset).aggregate) {
    const value = evaluateCalculatedFormula(field.calculated.formula, dataset, rows, null, false);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  return fallback(rows.map(row => row[field?.id ?? ""]), rows.length, aggregation);
}
