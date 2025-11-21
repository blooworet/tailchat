/**
 * Backfill usernameLower, generate compliant usernames for legacy users, and create unique index.
 * - usernameLower := lower(username)
 * - if username missing/invalid: derive from nickname and resolve conflicts
 */
module.exports = {
  async up(db) {
    const users = db.collection('users');

    // 排除机器人用户，机器人用户由专门的迁移脚本处理
    const cursor = users.find({ type: { $nin: ['pluginBot', 'openapiBot'] } }, { projection: { _id: 1, username: 1, usernameLower: 1, nickname: 1 } });
    const taken = new Set();

    const existing = await users
      .find({ usernameLower: { $type: 'string' } }, { projection: { usernameLower: 1 } })
      .toArray();
    existing.forEach((d) => d.usernameLower && taken.add(d.usernameLower));

    const USERNAME_REGEX = /^(?!_)[A-Za-z0-9_]{5,32}(?<!_)$/;
    const normalize = (nickname) => {
      if (!nickname || typeof nickname !== 'string') return '';
      const lower = nickname.toLowerCase();
      const replaced = lower.replace(/[^a-z0-9_]+/g, '_');
      const collapsed = replaced.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
      return collapsed;
    };
    const isValid = (name) => {
      if (!name || typeof name !== 'string') return false;
      if (!USERNAME_REGEX.test(name)) return false;
      const lower = name.toLowerCase();
      if (lower.endsWith('bot')) return false; // reserve for human default
      const reserved = new Set([
        'admin','root','system','official','support','help','security','moderator','staff','team','ops','tailchat','api','www','mail','dev','test','about','terms','privacy','status',
      ]);
      if (reserved.has(lower)) return false;
      return true;
    };
    const shortHash = (s, len = 4) => require('crypto').createHash('sha1').update(String(s)).digest('hex').slice(0, len);

    const allocate = (base, id) => {
      let candidate = base;
      let i = 0;
      while (i < 100 && (taken.has(candidate) || !isValid(candidate))) {
        i += 1;
        candidate = `${base}_${i}`;
      }
      if (taken.has(candidate) || !isValid(candidate)) {
        candidate = `${base}_${shortHash(String(id), 4)}`;
      }
      taken.add(candidate);
      return candidate;
    };

    const batch = [];
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) break;

      if (typeof doc.username === 'string' && isValid(doc.username)) {
        const lower = doc.username.toLowerCase();
        if (doc.usernameLower !== lower) {
          batch.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { usernameLower: lower } } } });
          taken.add(lower);
        }
        continue;
      }

      const base = normalize(doc.nickname) || `user_${shortHash(String(doc._id), 4)}`;
      const allocated = allocate(base, doc._id);
      batch.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { username: allocated, usernameLower: allocated.toLowerCase() } },
        },
      });

      if (batch.length >= 500) {
        await users.bulkWrite(batch, { ordered: false });
        batch.length = 0;
      }
    }
    if (batch.length > 0) {
      await users.bulkWrite(batch, { ordered: false });
    }

    const indexes = await users.indexes();
    const hasUnique = indexes.some((i) => i.key && i.key.usernameLower && i.unique === true);
    if (!hasUnique) {
      await users.createIndex({ usernameLower: 1 }, { unique: true, name: 'usernameLower_unique' });
    }

    console.log('[migration] username unique done');
  },

  async down(db) {
    const users = db.collection('users');
    try {
      await users.dropIndex('usernameLower_unique');
    } catch (e) {
      // ignore
    }
  },
};


