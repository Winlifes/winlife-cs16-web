package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"slices"

	"winlife.local/cs16-gateway/internal/combat"
)

type mapOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Duel bool   `json:"duel,omitempty"`
	Hide bool   `json:"hide,omitempty"`
}

var mapCatalog = []mapOption{
	{ID: "de_dust2", Name: "沙漠 II"}, {ID: "cs_assault", Name: "仓库突袭"}, {ID: "cs_mansion", Name: "豪宅"},
	{ID: "de_inferno", Name: "炼狱"}, {ID: "cs_italy", Name: "意大利"}, {ID: "de_dust", Name: "沙漠 I"},
	{ID: "de_nuke", Name: "核子危机"}, {ID: "de_train", Name: "列车站"}, {ID: "de_aztec", Name: "阿兹特克"}, {ID: "cs_office", Name: "办公大楼"},
	{ID: "wl_duel_yard", Name: "双箱庭院", Duel: true}, {ID: "wl_duel_cross", Name: "折角回廊", Duel: true},
	{ID: "wl_hide_depot", Name: "转运仓库", Hide: true}, {ID: "wl_hide_nursery", Name: "苗圃后院", Hide: true},
}

func hasMap(maps []mapOption, id string) bool {
	return slices.ContainsFunc(maps, func(option mapOption) bool { return option.ID == id })
}

func modeMaps(maps []mapOption, mode string) []mapOption {
	var available []mapOption
	for _, option := range maps {
		if option.Duel == (mode == duelMode) && option.Hide == (mode == hideMode) {
			available = append(available, option)
		}
	}
	return available
}

func installedMaps(gameDir, publicDir string) []mapOption {
	var manifest struct {
		Maps []string `json:"maps"`
	}
	if data, err := os.ReadFile(filepath.Join(publicDir, "assets-manifest.json")); err == nil {
		_ = json.Unmarshal(data, &manifest)
	}
	maps := []mapOption{}
	for _, option := range mapCatalog {
		if manifest.Maps != nil && !slices.Contains(manifest.Maps, option.ID) {
			continue
		}
		if info, err := os.Stat(filepath.Join(gameDir, "cstrike", "maps", option.ID+".bsp")); err == nil && info.Mode().IsRegular() {
			maps = append(maps, option)
		}
	}
	return maps
}

const (
	classicMode    = "classic"
	duelMode       = "duel"
	deathmatchMode = "deathmatch"
	individualMode = combat.FreeForAllMode
	infectionMode  = "infection"
	hideMode       = "hide"
	partyCapacity  = 10
)

func isPartyMode(mode string) bool { return mode == infectionMode || mode == hideMode }

func nativeGameModes(gameDir string) (party, individual bool) {
	extension := ".so"
	if runtime.GOOS == "darwin" {
		extension = ".dylib"
	}
	path := filepath.Join(gameDir, "cstrike", "dlls", "cs_"+runtime.GOARCH+extension)
	data, err := os.ReadFile(path)
	if err != nil {
		return false, false
	}
	return bytes.Contains(data, []byte("winlife_party_reset\x00")), bytes.Contains(data, []byte("mp_freeforall\x00"))
}

type modeOption struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

var modeCatalog = []modeOption{
	{classicMode, "经典对局", "每半场 15 小局，先赢 16 局。"},
	{duelMode, "1v1 单挑", "每边一人，出生装备相同，先赢 7 局。"},
	{deathmatchMode, "团队死斗", "阵亡约 2 秒后复活，可随时购买。先到 30 击杀获胜，限时 8 分钟。"},
	{individualMode, "个人竞技", "所有其他玩家均为对手，阵亡约 2 秒后复活。先到 30 次击杀获胜，或在 8 分钟结束时按击杀数排名。"},
	{infectionMode, "生化感染", "2–10 名真人。随机一人先感染，准备 6 秒。人类守住 100 秒或消灭感染者即可获胜。"},
	{hideMode, "躲猫猫", "2–10 名真人。躲藏者按 B 选择道具。准备 20 秒，追捕 75 秒，两局交换角色。"},
}

func installedModes(maps []mapOption, party, individual bool) []modeOption {
	var modes []modeOption
	for _, mode := range modeCatalog {
		if (isPartyMode(mode.ID) && !party) || (mode.ID == individualMode && !individual) {
			continue
		}
		if len(modeMaps(maps, mode.ID)) > 0 {
			modes = append(modes, mode)
		}
	}
	return modes
}

func modeConfig(mode string) string {
	const deathmatchRules = "mp_round_infinite 1\nmp_roundtime 0\nmp_freezetime 1\n" +
		"mp_forcerespawn 2\nmp_respawn_immunitytime 2\nmp_give_player_c4 0\n" +
		"mp_buy_anywhere 1\nmp_buytime -1\nmp_startmoney 16000\nmp_free_armor 2\n"
	const partyRules = "mp_round_infinite 1\nmp_roundtime 0\nmp_freezetime 0\nmp_roundrespawn_time -1\n" +
		"mp_give_player_c4 0\nmp_weapondrop 0\nmp_ammodrop 0\nmp_autoteambalance 0\n" +
		"mp_t_default_weapons_secondary \"\"\nmp_ct_default_weapons_secondary \"\"\n"
	switch mode {
	case duelMode:
		return "mp_limitteams 1\nmp_roundtime 1\nmp_roundover 1\nmp_free_armor 2\n" +
			"mp_t_default_weapons_primary ak47\nmp_ct_default_weapons_primary ak47\n" +
			"mp_t_default_weapons_secondary deagle\nmp_ct_default_weapons_secondary deagle\n"
	case deathmatchMode:
		return deathmatchRules + "mp_t_default_weapons_primary ak47\nmp_ct_default_weapons_primary m4a1\n"
	case individualMode:
		return deathmatchRules + "mp_freeforall 1\nmp_autoteambalance 0\nmp_limitteams 0\n" +
			"mp_t_default_weapons_primary ak47\nmp_ct_default_weapons_primary ak47\n" +
			"mp_t_default_weapons_secondary deagle\nmp_ct_default_weapons_secondary deagle\n"
	case infectionMode:
		return partyRules + "winlife_party_mode 1\n"
	case hideMode:
		return partyRules + "winlife_party_mode 2\n"
	}
	return ""
}
