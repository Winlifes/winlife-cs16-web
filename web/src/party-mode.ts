export function isPartyMode(mode?: string): boolean {
    return mode === "infection" || mode === "hide";
}

export function partyRole(mode: string | undefined, team: number | undefined): string {
    if (team !== 1 && team !== 2) return "旁观";
    if (mode === "infection") return team === 1 ? "感染者" : "人类";
    return team === 1 ? "躲藏者" : "追捕者";
}

export const hideProps = ["沙袋托盘", "灌木", "石块", "文件柜", "绿植"] as const;

export function parseDisguise(line: string): {choice: number; available: number} | undefined {
    const match = /^(?:\[\d{2}:\d{2}:\d{2}\]\s*)?WINLIFE_PROP 1 ([0-5]) (\d{1,2})\s*$/.exec(line.trim());
    if (!match) return;
    const choice = Number(match[1]), available = Number(match[2]);
    if (available >= (1 << hideProps.length) || (choice > 0 && !(available & (1 << (choice - 1))))) return;
    return {choice, available};
}
