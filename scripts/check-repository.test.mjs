import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectTrackedFile } from './check-repository.mjs';

test('rejects local recordings, label projects, generated tables and build output', () => {
  for (const path of ['recording.mkv', 'clip.mkv.firecrackle/project.json', 'fire-detection/data/joined/table.csv', '.claude/launch.json', 'FireCrackle/dist/app.js', '.env', 'release.rar', 'app.AppImage', 'app.deb', 'app.rpm', 'app.tar.gz', 'app.tgz']) {
    assert.ok(inspectTrackedFile(path, 10).length, path);
  }
});
test('rejects game/mapping artifacts while allowing the actual Gradle wrapper and own mod', () => {
  for (const path of ['minecraft-client.jar', 'yarn.tiny', 'Game.class', 'net/minecraft/client/Client.java']) {
    assert.ok(inspectTrackedFile(path, 10).length, path);
  }
  assert.equal(inspectTrackedFile('custom/Client.java', 10, 'package net.minecraft.client;').length, 1);
  assert.deepEqual(inspectTrackedFile('fire-detection/mod/gradle/wrapper/gradle-wrapper.jar', 50000), []);
  assert.deepEqual(inspectTrackedFile('fire-detection/mod-gui/gradle/wrapper/gradle-wrapper.jar', 50000), []);
  assert.deepEqual(inspectTrackedFile('fire-detection/mod/src/main/java/org/firecracking/FireLabel.java', 1000, 'package org.firecracking;'), []);
});
test('reports credential types without echoing their values', () => {
  const value = 'gh' + 'p_' + 'a'.repeat(36);
  const issues = inspectTrackedFile('settings.json', 100, `token=${value}`);
  assert.ok(issues.includes('possible credential/private key'));
  assert.ok(!issues.join().includes(value));
});
test('permits small source fixtures and environment examples but rejects oversized files', () => {
  assert.deepEqual(inspectTrackedFile('testdata/fire.rgba', 32768), []);
  assert.deepEqual(inspectTrackedFile('.env.example', 100, 'OBS_PASSWORD='), []);
  assert.ok(inspectTrackedFile('experiment.csv', 6 * 1024 * 1024).length);
});
