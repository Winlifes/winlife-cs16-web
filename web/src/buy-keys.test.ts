import {expect,it} from "vitest";
import {buyKeyAction} from "./buy-keys";
it("keeps keyboard purchases on the native menu close path",()=>{
    expect(buyKeyAction("buy","1")).toBe("+menu_slot1; wait; -menu_slot1");
    expect(buyKeyAction("buy_pistol_t","4")).toContain("_menu_select_slot4; wait; _menu_confirmed");
    expect(buyKeyAction("buy_pistol_t","4")).toMatch(/_erase_frame$/);
    expect(buyKeyAction("buy","b")).toBe("_erase_frame");
    expect(buyKeyAction(undefined,"1")).toBeUndefined();
    expect(buyKeyAction("buy_machinegun_t","2")).toBeUndefined();
    expect(buyKeyAction("buy_item_t","8")).toBeUndefined();
});
