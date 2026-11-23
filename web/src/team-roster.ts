import type { NativeRosterPlayer } from "./game-telemetry";

export class TeamRoster {
    private readonly columns = [1, 2].map(team => ({
        team,
        count: document.getElementById(`team-count-${team}`)!,
        list: document.getElementById(`team-roster-${team}`)!,
        empty: document.getElementById(`team-roster-empty-${team}`)!,
    }));
    private timer?: ReturnType<typeof setInterval>;
    private signature = "";

    constructor(private readonly read: () => NativeRosterPlayer[]) {}

    setVisible(visible: boolean): void {
        if (!visible) {
            clearInterval(this.timer);
            this.timer = undefined;
            return;
        }
        this.render();
        this.timer ??= setInterval(() => this.render(), 500);
    }

    private render(): void {
        const players = this.read();
        // The native roster includes the local player before they pick a team.
        const synced = players.length > 0;
        const namesByTeam = this.columns.map(({ team }) => players.filter(player => player.team === team).map(player => player.name));
        const signature = JSON.stringify([synced, namesByTeam]);
        if (signature === this.signature) return;
        this.signature = signature;

        this.columns.forEach(({ count, list, empty }, index) => {
            const names = namesByTeam[index];
            count.textContent = synced ? `${names.length} 人` : "—";
            list.replaceChildren(...names.map(name => {
                const item = document.createElement("li");
                item.textContent = name;
                item.title = name;
                return item;
            }));
            list.hidden = names.length === 0;
            empty.hidden = !list.hidden;
            empty.textContent = synced ? "暂无队员" : "正在同步名单…";
        });
    }
}
