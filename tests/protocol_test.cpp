#include "../components/remote_webview/protocol.h"
#include <cassert>
#include <limits>
#include <vector>

using namespace esphome::remote_webview::proto;

int main() {
  std::vector<uint8_t> packet(25, 0);
  packet[0] = uint8_t(MsgType::Frame);
  packet[1] = kProtocolVersion;
  wr32(packet.data() + 2, 7);
  packet[6] = uint8_t(Encoding::RAW565);
  wr16(packet.data() + 7, 1);
  wr16(packet.data() + 9, kFlagIsFullFrame | kFlagLastOfFrame);
  wr16(packet.data() + 15, 1);
  wr16(packet.data() + 17, 1);
  wr32(packet.data() + 19, 2);
  assert(validate_frame_packet(packet.data(), packet.size(), 480, 480));
  // Every truncation must fail before touching the display.
  for (size_t n = 0; n < packet.size(); ++n)
    assert(!validate_frame_packet(packet.data(), n, 480, 480));
  assert(!validate_frame_packet(nullptr, 100, 480, 480));
  TileHeader tile{};
  size_t offset = std::numeric_limits<size_t>::max();
  assert(!parse_tile_header(packet.data(), packet.size(), tile, offset));
  wr32(packet.data() + 19, 0xffffffffu);
  assert(!validate_frame_packet(packet.data(), packet.size(), 480, 480));
  wr32(packet.data() + 19, 2);
  wr16(packet.data() + 11, 480); // x is outside the physical display.
  assert(!validate_frame_packet(packet.data(), packet.size(), 480, 480));
  wr16(packet.data() + 11, 0);
  packet[6] = uint8_t(Encoding::RAW565_RLE);
  assert(!validate_frame_packet(packet.data(), packet.size(), 480, 480));
  packet[6] = uint8_t(Encoding::RAW565);
  packet.push_back(0);
  assert(!validate_frame_packet(packet.data(), packet.size(), 480, 480));
  packet.pop_back();
  packet[1] = kProtocolVersion + 1;
  assert(!validate_frame_packet(packet.data(), packet.size(), 480, 480));
}
