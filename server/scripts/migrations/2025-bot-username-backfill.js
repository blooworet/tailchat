module.exports = {
  async up(db) {
    const users = db.collection('users');

    // 1) Load existing taken usernames (lowercase)
    const taken = new Set();
    const existing = await users
      .find({ usernameLower: { $type: 'string' } }, { projection: { usernameLower: 1 } })
      .toArray();
    existing.forEach((d) => d.usernameLower && taken.add(String(d.usernameLower)));

    // Helpers
    const crypto = require('crypto');
    const toLower = (s) => String(s || '').toLowerCase();
    const shortHash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 6);
    const isAllowedChar = (ch) => /[A-Za-z0-9_]/.test(ch);
    const sanitize = (raw) => {
      const s = String(raw || '');
      let out = '';
      for (const ch of s) {
        if (isAllowedChar(ch)) out += ch;
      }
      // Trim leading/trailing underscore
      out = out.replace(/^_+/, '').replace(/_+$/, '');
      // Enforce length bounds rough; final check later
      if (out.length < 3) out = 'bot';
      if (out.length > 32) out = out.slice(0, 32);
      return out;
    };
    const ensureBotSuffix = (base) => {
      const lower = toLower(base);
      if (lower.endsWith('bot')) return base;
      return `${base}${base.endsWith('_') ? '' : ''}bot`;
    };
    const withinLen = (name) => {
      if (name.length < 5) return name.padEnd(5, '0');
      if (name.length > 32) return name.slice(0, 32);
      return name;
    };
    const isValid = (name) => {
      if (typeof name !== 'string') return false;
      if (name.length < 5 || name.length > 32) return false;
      if (!/^[A-Za-z0-9_]+$/.test(name)) return false;
      if (name.startsWith('_') || name.endsWith('_')) return false;
      if (!toLower(name).endsWith('bot')) return false;
      return true;
    };
    const allocate = (base, id) => {
      let candidate = withinLen(ensureBotSuffix(sanitize(base)));
      let i = 0;
      while (i < 100) {
        const lower = toLower(candidate);
        if (isValid(candidate) && !taken.has(lower)) {
          taken.add(lower);
          return candidate;
        }
        i += 1;
        candidate = withinLen(`${ensureBotSuffix(sanitize(base))}_${i}`);
      }
      const fallback = withinLen(`${ensureBotSuffix(sanitize(base))}_${shortHash(id)}`);
      const lower = toLower(fallback);
      taken.add(lower);
      return fallback;
    };

    // 2) Scan bots and backfill
    const cursor = users.find(
      { type: { $in: ['pluginBot', 'openapiBot'] } },
      { projection: { _id: 1, username: 1, usernameLower: 1, nickname: 1 } }
    );

    const batch = [];
    let updated = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) break;

      // If username is already valid for bot rule, just ensure usernameLower
      if (typeof doc.username === 'string' && isValid(doc.username)) {
        const lower = toLower(doc.username);
        if (doc.usernameLower !== lower) {
          batch.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { usernameLower: lower } } } });
          taken.add(lower);
          updated += 1;
        }
        if (batch.length >= 500) {
          await users.bulkWrite(batch, { ordered: false });
          batch.length = 0;
        }
        continue;
      }

      // Need allocate a compliant unique username
      const base = doc.nickname || `bot_${shortHash(doc._id)}`;
      const allocated = allocate(base, doc._id);
      batch.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { username: allocated, usernameLower: toLower(allocated) } },
        },
      });
      updated += 1;
      if (batch.length >= 500) {
        await users.bulkWrite(batch, { ordered: false });
        batch.length = 0;
      }
    }
    if (batch.length > 0) {
      await users.bulkWrite(batch, { ordered: false });
    }

    console.log(`[migration] bot username backfill updated: ${updated}`);
  },
  async down(db) {
    // No safe down migration (usernames may be relied upon). Intentionally no-op.
    console.log('[migration] bot username backfill: down noop');
  },
};


