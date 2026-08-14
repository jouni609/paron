"use strict";

const { test } = require("brittle");
const createTestnet = require("hyperdht/testnet");
const ParonRoom = require("../lib/room.js");

test("Room topic derivation from name and 64-hex code", (t) => {
  const byName1 = ParonRoom.deriveTopic("tiimi-palaveri");
  const byName2 = ParonRoom.deriveTopic("tiimi-palaveri");
  const byNameDifferent = ParonRoom.deriveTopic("toinen-huone");

  t.is(byName1.roomCode, byName2.roomCode, "Same name produces identical code");
  t.is(byName1.topic.length, 32, "Topic buffer is 32 bytes");
  t.not(
    byName1.roomCode,
    byNameDifferent.roomCode,
    "Different names produce different codes",
  );

  const byHex = ParonRoom.deriveTopic(byName1.roomCode);
  t.is(
    byHex.roomCode,
    byName1.roomCode,
    "Joining via 64-hex code produces same topic",
  );
});

test("Two peers connect in the same room and exchange messages", async (t) => {
  const testnet = await createTestnet(3);
  const bootstrap = testnet.bootstrap;

  const roomName = "test-room-" + Math.random().toString(36).slice(2);

  const alice = new ParonRoom({ name: "Alice", bootstrap });
  const bob = new ParonRoom({ name: "Bob", bootstrap });

  t.teardown(async () => {
    await alice.leave();
    await bob.leave();
    await testnet.destroy();
  });

  await alice.join(roomName);
  t.ok(alice.roomCode, "Alice joined and got roomCode");

  // Bob joins using Alice's roomCode
  await bob.join(alice.roomCode);

  const aliceSawBob = new Promise((resolve) => {
    alice.on("peer-join", (peer) => {
      if (peer.name === "Bob") resolve(peer);
    });
  });

  const bobSawAlice = new Promise((resolve) => {
    bob.on("peer-join", (peer) => {
      if (peer.name === "Alice") resolve(peer);
    });
  });

  const [peerBob, peerAlice] = await Promise.all([aliceSawBob, bobSawAlice]);

  t.is(peerBob.name, "Bob", "Alice saw Bob connect");
  t.is(peerAlice.name, "Alice", "Bob saw Alice connect");

  // Test chat messaging
  const chatReceivedPromise = new Promise((resolve) => {
    bob.on("chat", (msg) => {
      resolve(msg);
    });
  });

  alice.broadcastChat("Moi Bob!");
  const receivedMsg = await chatReceivedPromise;
  t.is(receivedMsg.text, "Moi Bob!", "Bob received Alice's chat message");

  // Test mute state sync
  const muteReceivedPromise = new Promise((resolve) => {
    bob.on("peer-state", (peer) => {
      if (peer.name === "Alice" && peer.isMuted === true) {
        resolve(peer);
      }
    });
  });

  alice.setMute(true);
  const mutedPeer = await muteReceivedPromise;
  t.is(mutedPeer.isMuted, true, "Bob noticed Alice muted herself");
});
