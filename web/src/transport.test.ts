import {afterEach, expect, it, vi} from "vitest";
import {WebSocketClient} from "./core/websocket";
import {WebRTCTransport} from "./transport";
import {FakePeerConnection, FakeWebSocket, createFakeLogger} from "./testing/fakes";

let transport: WebRTCTransport;
afterEach(() => {transport?.stop(); vi.useRealTimers(); vi.unstubAllGlobals();});

it("recovers a stalled first handshake without reloading the game", async () => {
    vi.useFakeTimers();
    FakeWebSocket.reset(); FakePeerConnection.reset();
    vi.stubGlobal("window", {location: {protocol: "https:", host: "game.test"}});
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const logger = createFakeLogger();
    const socket = new WebSocketClient({url: "/websocket", logger, autoReconnect: false});
    transport = new WebRTCTransport({socket, logger, getUserMedia: async () => undefined,
        createPeerConnection: () => new FakePeerConnection() as unknown as RTCPeerConnection});
    const ready = vi.fn(); transport.onReady = ready;
    const started = transport.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(11000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.last.open();
    const channels = FakePeerConnection.last.emitDataChannels();
    channels.read.open(); channels.write.open();
    await started;
    expect(transport.ready).toBe(true);
    expect(ready).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15000);
    expect(FakeWebSocket.instances).toHaveLength(2);
});
