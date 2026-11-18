import type { Recurrence } from "./models";

export function occurrenceDates(rule: Recurrence, month: string): string[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const dates: string[] = [];
  if (rule.frequency === "monthly") dates.push(`${month}-${String(Math.min(rule.day, lastDay)).padStart(2, "0")}`);
  if (rule.frequency === "yearly" && Number(rule.startDate.slice(5, 7)) === monthNumber) dates.push(`${month}-${String(Math.min(rule.day, lastDay)).padStart(2, "0")}`);
  if (rule.frequency === "weekly") {
    for (let day = 1; day <= lastDay; day += 1) {
      if (new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay() === rule.day) dates.push(`${month}-${String(day).padStart(2, "0")}`);
    }
  }
  return dates.filter((date) => date >= rule.startDate && (!rule.endDate || date <= rule.endDate));
}

export function occurrenceId(ruleId: string, date: string) { return `${ruleId}_${date}`; }
