"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split("");
const REVERSE = new Array(123).fill(-1);
for (let i = 0; i < ALPHABET.length; i += 1) {
  REVERSE[ALPHABET[i].charCodeAt(0)] = i;
}

const SHORT_MASK = 30;
const ENVIRONMENT_NAMES = {
  0: "Summer",
  1: "Winter",
  2: "Desert",
};
const ENVIRONMENT_IDS = {
  Summer: 0,
  Winter: 1,
  Desert: 2,
};
const ROTATION_AXIS_NAMES = {
  0: "YPositive",
  1: "YNegative",
  2: "XPositive",
  3: "XNegative",
  4: "ZPositive",
  5: "ZNegative",
};
const ROTATION_AXIS_IDS = {
  YPositive: 0,
  YNegative: 1,
  XPositive: 2,
  XNegative: 3,
  ZPositive: 4,
  ZNegative: 5,
};
const CHECKPOINT_IDS = new Set([52, 65, 75, 77]);
const START_IDS = new Set([5, 91, 92, 93]);

function fail(message) {
  throw new Error(message);
}

function usage() {
  console.error(
    [
      "Usage:",
      "  node track_tool.js decode <input.track> [output.json]",
      "  node track_tool.js encode <input.json> [output.track]",
      "",
      "Notes:",
      "  - `decode` autodetects PolyTrack export strings and save strings.",
      "  - `encode` writes an export string unless JSON contains `kind: \"save\"`.",
    ].join("\n"),
  );
  process.exit(1);
}

function readPackedValue(bytes, bitPos) {
  if (bitPos >= bytes.length * 8) {
    fail("Packed read out of range");
  }

  const byteIndex = Math.floor(bitPos / 8);
  const current = bytes[byteIndex];
  const offset = bitPos - byteIndex * 8;

  if (offset <= 2 || byteIndex >= bytes.length - 1) {
    return (current & (63 << offset)) >>> offset;
  }

  return ((current & (63 << offset)) >>> offset) | ((bytes[byteIndex + 1] & (63 >>> (8 - offset))) << (8 - offset));
}

function writePackedValue(output, bitPos, bitLength, value, isLast) {
  const byteIndex = Math.floor(bitPos / 8);
  while (output.length <= byteIndex) {
    output.push(0);
  }

  const offset = bitPos - byteIndex * 8;
  output[byteIndex] |= (value << offset) & 255;

  if (offset > 8 - bitLength && !isLast) {
    const nextIndex = byteIndex + 1;
    while (output.length <= nextIndex) {
      output.push(0);
    }
    output[nextIndex] |= value >> (8 - offset);
  }
}

function encodeBase62Like(bytes) {
  let bitPos = 0;
  let text = "";

  while (bitPos < bytes.length * 8) {
    const value = readPackedValue(bytes, bitPos);
    if ((value & SHORT_MASK) === SHORT_MASK) {
      text += ALPHABET[value & 31];
      bitPos += 5;
    } else {
      text += ALPHABET[value];
      bitPos += 6;
    }
  }

  return text;
}

function decodeBase62Like(text) {
  let bitPos = 0;
  const output = [];

  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= REVERSE.length) {
      return null;
    }

    const value = REVERSE[code];
    if (value === -1) {
      return null;
    }

    const bitLength = (value & SHORT_MASK) === SHORT_MASK ? 5 : 6;
    writePackedValue(output, bitPos, bitLength, value, i === text.length - 1);
    bitPos += bitLength;
  }

  return Uint8Array.from(output);
}

function readUintLE(bytes, offset, length) {
  if (offset + length > bytes.length) {
    fail("Unexpected end of data");
  }

  let value = 0;
  for (let i = 0; i < length; i += 1) {
    value += bytes[offset + i] * 2 ** (8 * i);
  }
  return value;
}

function readInt32LE(bytes, offset) {
  if (offset + 4 > bytes.length) {
    fail("Unexpected end of data");
  }

  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
}

function writeUintLE(value, length) {
  const buffer = Buffer.alloc(length);
  let remaining = value;
  for (let i = 0; i < length; i += 1) {
    buffer[i] = remaining & 255;
    remaining = Math.floor(remaining / 256);
  }
  return buffer;
}

function writeInt32LE(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value, 0);
  return buffer;
}

function inflateToBuffer(buffer) {
  return zlib.inflateSync(buffer);
}

function inflateToString(buffer) {
  return zlib.inflateSync(buffer).toString("utf8");
}

function deflateBuffer(buffer, windowBits) {
  return zlib.deflateSync(buffer, {
    level: 9,
    memLevel: 9,
    windowBits,
  });
}

function compareNullable(a, b) {
  return (a ?? -1) - (b ?? -1);
}

function compareParts(a, b) {
  return (
    a.id - b.id ||
    a.x - b.x ||
    a.y - b.y ||
    a.z - b.z ||
    a.rotation - b.rotation ||
    a.rotationAxis - b.rotationAxis ||
    a.color - b.color ||
    compareNullable(a.checkpointOrder, b.checkpointOrder) ||
    compareNullable(a.startOrder, b.startOrder)
  );
}

function integerField(value, label) {
  if (!Number.isInteger(value)) {
    fail(`${label} must be an integer`);
  }
  return value;
}

function parseRotationAxis(value) {
  if (Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value in ROTATION_AXIS_IDS) {
    return ROTATION_AXIS_IDS[value];
  }
  fail("rotationAxis must be an integer or a known axis name");
}

function parseEnvironment(value) {
  if (Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value in ENVIRONMENT_IDS) {
    return ENVIRONMENT_IDS[value];
  }
  fail("environmentId must be an integer or a known environment name");
}

function normalizeTrack(input) {
  const track = input.track || input.trackData || input;
  const environmentId = parseEnvironment(track.environmentId ?? track.environment);

  let sunAngleRepresentation = track.sunAngleRepresentation;
  if (!Number.isInteger(sunAngleRepresentation)) {
    if (Number.isInteger(track.sunAngle)) {
      sunAngleRepresentation = track.sunAngle;
    } else if (typeof track.sunAngleDegrees === "number") {
      sunAngleRepresentation = Math.round(track.sunAngleDegrees / 2);
    } else {
      fail("Missing sunAngleRepresentation or sunAngleDegrees");
    }
  }

  if (sunAngleRepresentation < 0 || sunAngleRepresentation >= 180) {
    fail("sunAngleRepresentation must be in the range 0-179");
  }

  if (!Array.isArray(track.parts)) {
    fail("track.parts must be an array");
  }

  const parts = track.parts.map((part, index) => {
    const id = integerField(part.id, `parts[${index}].id`);
    const x = integerField(part.x, `parts[${index}].x`);
    const y = integerField(part.y, `parts[${index}].y`);
    const z = integerField(part.z, `parts[${index}].z`);
    const rotation = integerField(part.rotation, `parts[${index}].rotation`);
    const rotationAxis = parseRotationAxis(part.rotationAxis);
    const color = integerField(part.color ?? 0, `parts[${index}].color`);
    const checkpointOrder = part.checkpointOrder == null ? null : integerField(part.checkpointOrder, `parts[${index}].checkpointOrder`);
    const startOrder = part.startOrder == null ? null : integerField(part.startOrder, `parts[${index}].startOrder`);

    return {
      id,
      x,
      y,
      z,
      rotation,
      rotationAxis,
      color,
      checkpointOrder,
      startOrder,
    };
  });

  return {
    environmentId,
    environmentName: ENVIRONMENT_NAMES[environmentId] ?? null,
    sunAngleRepresentation,
    sunAngleDegrees: sunAngleRepresentation * 2,
    parts,
  };
}

function parseRawTrackBytes(bytes, offset = 0) {
  let cursor = offset;

  if (bytes.length - cursor < 15) {
    fail("Track payload is too short");
  }

  const environmentId = bytes[cursor];
  cursor += 1;
  const sunAngleRepresentation = bytes[cursor];
  cursor += 1;

  const minX = readInt32LE(bytes, cursor);
  cursor += 4;
  const minY = readInt32LE(bytes, cursor);
  cursor += 4;
  const minZ = readInt32LE(bytes, cursor);
  cursor += 4;

  const sizeByte = bytes[cursor];
  cursor += 1;
  const sizeX = sizeByte & 3;
  const sizeY = (sizeByte >> 2) & 3;
  const sizeZ = (sizeByte >> 4) & 3;

  if (sizeX < 1 || sizeX > 4 || sizeY < 1 || sizeY > 4 || sizeZ < 1 || sizeZ > 4) {
    fail("Invalid packed coordinate widths");
  }

  const parts = [];
  while (cursor < bytes.length) {
    const id = bytes[cursor];
    cursor += 1;

    const count = readUintLE(bytes, cursor, 4);
    cursor += 4;

    for (let i = 0; i < count; i += 1) {
      const x = readUintLE(bytes, cursor, sizeX) + minX;
      cursor += sizeX;
      const y = readUintLE(bytes, cursor, sizeY) + minY;
      cursor += sizeY;
      const z = readUintLE(bytes, cursor, sizeZ) + minZ;
      cursor += sizeZ;

      if (cursor >= bytes.length) {
        fail("Unexpected end of part data");
      }

      const packedRotation = bytes[cursor];
      cursor += 1;
      const rotation = packedRotation & 3;
      const rotationAxis = (packedRotation >> 2) & 7;

      if (cursor >= bytes.length) {
        fail("Unexpected end of part data");
      }

      const color = bytes[cursor];
      cursor += 1;

      let checkpointOrder = null;
      if (CHECKPOINT_IDS.has(id)) {
        checkpointOrder = readUintLE(bytes, cursor, 2);
        cursor += 2;
      }

      let startOrder = null;
      if (START_IDS.has(id)) {
        startOrder = readUintLE(bytes, cursor, 4);
        cursor += 4;
      }

      parts.push({
        id,
        x,
        y,
        z,
        rotation,
        rotationAxis,
        rotationAxisName: ROTATION_AXIS_NAMES[rotationAxis] ?? null,
        color,
        checkpointOrder,
        startOrder,
      });
    }
  }

  return {
    nextOffset: cursor,
    track: {
      environmentId,
      environmentName: ENVIRONMENT_NAMES[environmentId] ?? null,
      sunAngleRepresentation,
      sunAngleDegrees: sunAngleRepresentation * 2,
      parts,
    },
  };
}

function buildRawTrackBytes(input) {
  const track = normalizeTrack(input);
  const parts = [...track.parts].sort(compareParts);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const part of parts) {
    minX = Math.min(minX, part.x);
    minY = Math.min(minY, part.y);
    minZ = Math.min(minZ, part.z);
    maxX = Math.max(maxX, part.x);
    maxY = Math.max(maxY, part.y);
    maxZ = Math.max(maxZ, part.z);
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    minZ = 0;
    maxX = 0;
    maxY = 0;
    maxZ = 0;
  }

  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  const spanZ = maxZ - minZ + 1;
  const sizeX = Math.max(1, Math.min(4, Math.ceil(Math.log2(spanX + 1) / 8)));
  const sizeY = Math.max(1, Math.min(4, Math.ceil(Math.log2(spanY + 1) / 8)));
  const sizeZ = Math.max(1, Math.min(4, Math.ceil(Math.log2(spanZ + 1) / 8)));

  const chunks = [];
  chunks.push(Buffer.from([track.environmentId]));
  chunks.push(Buffer.from([track.sunAngleRepresentation]));
  chunks.push(writeInt32LE(minX));
  chunks.push(writeInt32LE(minY));
  chunks.push(writeInt32LE(minZ));
  chunks.push(Buffer.from([sizeX | (sizeY << 2) | (sizeZ << 4)]));

  const grouped = new Map();
  for (const part of parts) {
    if (!grouped.has(part.id)) {
      grouped.set(part.id, []);
    }
    grouped.get(part.id).push(part);
  }

  const ids = [...grouped.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const group = grouped.get(id);
    chunks.push(Buffer.from([id]));
    chunks.push(writeUintLE(group.length, 4));

    for (const part of group) {
      chunks.push(writeUintLE(part.x - minX, sizeX));
      chunks.push(writeUintLE(part.y - minY, sizeY));
      chunks.push(writeUintLE(part.z - minZ, sizeZ));
      chunks.push(Buffer.from([(part.rotation & 3) | ((part.rotationAxis & 7) << 2)]));
      chunks.push(Buffer.from([part.color & 255]));

      if (CHECKPOINT_IDS.has(id)) {
        if (part.checkpointOrder == null) {
          fail(`Part id ${id} requires checkpointOrder`);
        }
        chunks.push(writeUintLE(part.checkpointOrder, 2));
      }

      if (START_IDS.has(id)) {
        if (part.startOrder == null) {
          fail(`Part id ${id} requires startOrder`);
        }
        chunks.push(writeUintLE(part.startOrder, 4));
      }
    }
  }

  return Buffer.concat(chunks);
}

function parseSaveString(text) {
  const cleaned = text.replace(/\s+/g, "");
  const outer = decodeBase62Like(cleaned);
  if (outer == null) {
    fail("Input is not a valid PolyTrack save string");
  }

  const stageOne = inflateToString(Buffer.from(outer));
  const inner = decodeBase62Like(stageOne);
  if (inner == null) {
    fail("Failed to decode inner save payload");
  }

  const raw = inflateToBuffer(Buffer.from(inner));
  const parsed = parseRawTrackBytes(raw);
  if (parsed.nextOffset !== raw.length) {
    fail("Trailing bytes detected in save payload");
  }

  return {
    kind: "save",
    sourceFormat: "PolyTrack-save",
    track: parsed.track,
  };
}

function parseExportString(text) {
  const cleaned = text.replace(/\s+/g, "");
  if (!cleaned.startsWith("PolyTrack2")) {
    fail("Input is not a PolyTrack export string");
  }

  const outer = decodeBase62Like(cleaned.slice(10));
  if (outer == null) {
    fail("Failed to decode export payload");
  }

  const stageOne = inflateToString(Buffer.from(outer));
  const inner = decodeBase62Like(stageOne);
  if (inner == null) {
    fail("Failed to decode inner export payload");
  }

  const payload = inflateToBuffer(Buffer.from(inner));
  let cursor = 0;

  if (payload.length < 1) {
    fail("Export payload is too short");
  }

  const nameLength = payload[cursor];
  cursor += 1;
  if (payload.length < cursor + nameLength) {
    fail("Invalid track name length");
  }
  const name = payload.subarray(cursor, cursor + nameLength).toString("utf8");
  cursor += nameLength;

  if (payload.length < cursor + 1) {
    fail("Missing author length");
  }
  const authorLength = payload[cursor];
  cursor += 1;
  let author = null;
  if (authorLength > 0) {
    if (payload.length < cursor + authorLength) {
      fail("Invalid author length");
    }
    author = payload.subarray(cursor, cursor + authorLength).toString("utf8");
    cursor += authorLength;
  }

  if (payload.length < cursor + 1) {
    fail("Missing lastModified flag");
  }
  const modifiedFlag = payload[cursor];
  cursor += 1;

  let lastModified = null;
  if (modifiedFlag === 1) {
    const seconds = readUintLE(payload, cursor, 4);
    cursor += 4;
    lastModified = new Date(seconds * 1000).toISOString();
  } else if (modifiedFlag !== 0) {
    fail("Invalid lastModified flag");
  }

  const parsed = parseRawTrackBytes(payload, cursor);
  if (parsed.nextOffset !== payload.length) {
    fail("Trailing bytes detected in export payload");
  }

  return {
    kind: "export",
    sourceFormat: "PolyTrack2-export",
    metadata: {
      name,
      author,
      lastModified,
    },
    track: parsed.track,
  };
}

function decodeInput(text) {
  const cleaned = text.replace(/\s+/g, "");
  if (cleaned.startsWith("PolyTrack2")) {
    return parseExportString(cleaned);
  }
  return parseSaveString(cleaned);
}

function buildSaveString(model) {
  const raw = buildRawTrackBytes(model);
  const inner = deflateBuffer(raw, 9);
  const middle = encodeBase62Like(inner);
  const outer = deflateBuffer(Buffer.from(middle, "utf8"), 15);
  return encodeBase62Like(outer);
}

function buildExportString(model) {
  const metadata = model.metadata || {};
  const name = metadata.name || "Modded Track";
  const author = metadata.author || null;
  const lastModified = metadata.lastModified == null ? null : new Date(metadata.lastModified);

  if (Number.isNaN(lastModified?.getTime())) {
    fail("metadata.lastModified is not a valid date");
  }

  const nameBytes = Buffer.from(name, "utf8");
  if (nameBytes.length > 255) {
    fail("metadata.name is too long");
  }

  const authorBytes = author == null ? Buffer.alloc(0) : Buffer.from(author, "utf8");
  if (authorBytes.length > 255) {
    fail("metadata.author is too long");
  }

  const modifiedBytes =
    lastModified == null
      ? Buffer.from([0])
      : Buffer.concat([
          Buffer.from([1]),
          writeUintLE(Math.floor(lastModified.getTime() / 1000), 4),
        ]);

  const metadataBuffer = Buffer.concat([
    Buffer.from([nameBytes.length]),
    nameBytes,
    Buffer.from([authorBytes.length]),
    authorBytes,
    modifiedBytes,
  ]);

  const raw = buildRawTrackBytes(model);
  const inner = deflateBuffer(Buffer.concat([metadataBuffer, raw]), 9);
  const middle = encodeBase62Like(inner);
  const outer = deflateBuffer(Buffer.from(middle, "utf8"), 15);
  return `PolyTrack2${encodeBase62Like(outer)}`;
}

function encodeModel(model) {
  if (model.kind === "save" || model.sourceFormat === "PolyTrack-save") {
    return buildSaveString(model);
  }
  return buildExportString(model);
}

function readTextFile(filePath) {
  return fs.readFileSync(filePath, "utf8").trim();
}

function writeTextFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function main() {
  const [, , command, inputPath, outputPath] = process.argv;
  if (!command || !inputPath) {
    usage();
  }

  if (command === "decode") {
    const decoded = decodeInput(readTextFile(inputPath));
    const output = JSON.stringify(decoded, null, 2);
    const destination = outputPath || `${inputPath}.json`;
    writeTextFile(destination, `${output}\n`);
    console.log(`Decoded ${path.basename(inputPath)} -> ${destination}`);
    return;
  }

  if (command === "encode") {
    const model = JSON.parse(readTextFile(inputPath));
    const encoded = encodeModel(model);
    const destination = outputPath || inputPath.replace(/\.json$/i, ".track");
    writeTextFile(destination, `${encoded}\n`);
    console.log(`Encoded ${path.basename(inputPath)} -> ${destination}`);
    return;
  }

  usage();
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
