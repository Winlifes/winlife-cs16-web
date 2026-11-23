package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
)

type mapOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Duel bool   `json:"duel,omitempty"`
}

var mapCatalog = []mapOption{
	{ID: "de_dust2", Name: "沙漠 II"}, {ID: "cs_assault", Name: "仓库突袭"}, {ID: "cs_mansion", Name: "豪宅"},
	{ID: "de_inferno", Name: "炼狱"}, {ID: "cs_italy", Name: "意大利"}, {ID: "de_dust", Name: "沙漠 I"},
	{ID: "de_nuke", Name: "核子危机"}, {ID: "de_train", Name: "列车站"}, {ID: "de_aztec", Name: "阿兹特克"}, {ID: "cs_office", Name: "办公大楼"},
	{ID: "wl_duel_yard", Name: "双箱庭院", Duel: true}, {ID: "wl_duel_cross", Name: "折角回廊", Duel: true},
}

func hasMap(maps []mapOption, id string) bool {
	return slices.ContainsFunc(maps, func(option mapOption) bool { return option.ID == id })
}

func modeMaps(maps []mapOption, mode string) []mapOption {
	var available []mapOption
	for _, option := range maps {
		if option.Duel == (mode == duelMode) {
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
)

type modeOption struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

var modeCatalog = []modeOption{
	{classicMode, "经典对局", "每半场 15 小局，先赢 16 局。"},
	{duelMode, "1v1 单挑", "每边一人，出生装备相同，先赢 7 局。"},
	{deathmatchMode, "团队死斗", "阵亡约 2 秒后复活，可随时购买。先到 30 击杀获胜，限时 8 分钟。"},
}

func installedModes(maps []mapOption) []modeOption {
	var modes []modeOption
	for _, mode := range modeCatalog {
		if len(modeMaps(maps, mode.ID)) > 0 {
			modes = append(modes, mode)
		}
	}
	return modes
}

func modeConfig(mode string) string {
	switch mode {
	case duelMode:
		return "mp_limitteams 1\nmp_roundtime 1\nmp_roundover 1\nmp_free_armor 2\n" +
			"mp_t_default_weapons_primary ak47\nmp_ct_default_weapons_primary ak47\n" +
			"mp_t_default_weapons_secondary deagle\nmp_ct_default_weapons_secondary deagle\n"
	case deathmatchMode:
		return "mp_round_infinite 1\nmp_roundtime 0\nmp_freezetime 1\n" +
			"mp_forcerespawn 2\nmp_respawn_immunitytime 2\nmp_give_player_c4 0\n" +
			"mp_buy_anywhere 1\nmp_buytime -1\nmp_startmoney 16000\nmp_free_armor 2\n" +
			"mp_t_default_weapons_primary ak47\nmp_ct_default_weapons_primary m4a1\n"
	}
	return ""
}
