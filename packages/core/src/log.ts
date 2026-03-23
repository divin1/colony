export function log(antName: string, msg: string): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${ts}] [${antName}] ${msg}`);
}
