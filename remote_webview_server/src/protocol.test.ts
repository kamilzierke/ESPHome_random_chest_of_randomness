import { describe, expect, test } from "vitest";
import {
  Encoding,
  FLAG_IS_FULL_FRAME,
  FLAG_LAST_OF_FRAME,
  FRAME_HEADER_BYTES,
  FRAME_STATS_BYTES,
  MsgType,
  PROTOCOL_VERSION,
  TILE_HEADER_BYTES,
  TOUCH_BYTES,
  TouchKind,
  buildFramePacket,
  buildFramePackets,
  buildFrameStatsPacket,
  buildTouchPacket,
  iterateTiles,
  parseFrameHeader,
  parseTouchPacket,
} from "./protocol.js";

describe("remote webview protocol", () => {
  test("buildTouchPacket generates 8-byte packets parsed as down, move and up", () => {
    const cases = [
      { kind: TouchKind.Down, x: 10, y: 20, pointerId: 1 },
      { kind: TouchKind.Move, x: 30, y: 40, pointerId: 2 },
      { kind: TouchKind.Up, x: 50, y: 60, pointerId: 3 },
    ];

    for (const item of cases) {
      const packet = buildTouchPacket(item.kind, item.x, item.y, item.pointerId);

      expect(packet).toHaveLength(TOUCH_BYTES);
      expect(packet.readUInt8(0)).toBe(MsgType.Touch);
      expect(packet.readUInt8(1)).toBe(PROTOCOL_VERSION);
      expect(parseTouchPacket(packet)).toEqual(item);
    }
  });

  test("buildFramePacket generates an 11-byte frame header plus a 12-byte tile header", () => {
    const tileData = Buffer.from([0xaa, 0xbb, 0xcc]);
    const packet = buildFramePacket(
      [{ x: 1, y: 2, w: 3, h: 4, data: tileData }],
      Encoding.JPEG,
      0x12345678,
      FLAG_LAST_OF_FRAME,
    );

    expect(packet).toHaveLength(FRAME_HEADER_BYTES + TILE_HEADER_BYTES + tileData.length);
    expect(parseFrameHeader(packet)).toEqual({
      frameId: 0x12345678,
      enc: Encoding.JPEG,
      tileCount: 1,
      flags: FLAG_LAST_OF_FRAME,
      payloadOffset: FRAME_HEADER_BYTES,
    });

    const tiles = Array.from(iterateTiles(packet, FRAME_HEADER_BYTES, 1));
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ x: 1, y: 2, w: 3, h: 4 });
    expect(tiles[0].data).toEqual(tileData);
  });

  test("buildFramePackets sets FLAG_LAST_OF_FRAME only on the final packet", () => {
    const rects = [
      { x: 0, y: 0, w: 2, h: 2, data: Buffer.from([1, 2, 3, 4]) },
      { x: 2, y: 0, w: 2, h: 2, data: Buffer.from([5, 6, 7, 8]) },
    ];

    const maxSingleTilePacket = FRAME_HEADER_BYTES + TILE_HEADER_BYTES + rects[0].data.length;
    const packets = buildFramePackets(rects, Encoding.JPEG, 7, true, maxSingleTilePacket);

    expect(packets).toHaveLength(2);
    expect(parseFrameHeader(packets[0])?.flags).toBe(FLAG_IS_FULL_FRAME);
    expect(parseFrameHeader(packets[1])?.flags).toBe(FLAG_IS_FULL_FRAME | FLAG_LAST_OF_FRAME);
  });

  test("FrameStats packets are 10 bytes, matching the C++ FrameStatsPacket", () => {
    const packet = buildFrameStatsPacket();

    expect(packet).toHaveLength(FRAME_STATS_BYTES);
    expect(FRAME_STATS_BYTES).toBe(10);
    expect(packet.readUInt8(0)).toBe(MsgType.FrameStats);
    expect(packet.readUInt8(1)).toBe(PROTOCOL_VERSION);
    expect(packet.readUInt32LE(2)).toBe(0);
    expect(packet.readUInt32LE(6)).toBe(0);
  });
});
