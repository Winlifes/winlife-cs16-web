export function isPartyMode(mode?: string): boolean {
    return mode === "infection" || mode === "hide";
}

export function partyRole(mode: string | undefined, team: number | undefined): string {
    if (team !== 1 && team !== 2) return "旁观";
    if (mode === "infection") return team === 1 ? "感染者" : "人类";
    return team === 1 ? "躲藏者" : "追捕者";
}
