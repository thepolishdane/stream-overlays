/* SSN activity-feed normalizer.
   Pure functions: raw capture entry -> canonical event(s).
   Works in browser (window.SSNNormalize) and Node (module.exports). */
(function (root) {
  'use strict';

  function stripHtml(html) {
    if (!html) return '';
    return String(html)
      .replace(/<svg[^>]*>[\s\S]*?<\/svg>/g, ' ')
      .replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseDonation(hasDonation) {
    if (!hasDonation) return null;
    var s = String(hasDonation).trim();
    /* Two formats observed:
         "10.00 USD" / "500 bits" / "100 Diamonds"  → number first
         "$10.00"   / "€5"       / "kr 50"          → unit first */
    var unitFirst = s.match(/^([A-Za-z€$£¥]+)\s*([\d,.]+)/);
    var numFirst  = s.match(/^([\d,.]+)\s*([A-Za-z€$£¥]+)/);
    var rawNum, rawUnit;
    if (unitFirst) { rawNum = unitFirst[2]; rawUnit = unitFirst[1]; }
    else if (numFirst) { rawNum = numFirst[1]; rawUnit = numFirst[2]; }
    else return { value: null, unit: null, raw: s };
    /* Normalize $ → usd, € → eur, £ → gbp, ¥ → jpy. Keep multi-letter codes lowercase. */
    var symMap = { '$':'usd','€':'eur','£':'gbp','¥':'jpy' };
    var unit = symMap[rawUnit] || rawUnit.toLowerCase();
    var num = parseFloat(rawNum.replace(/,/g, ''));
    return { value: isNaN(num) ? null : num, unit: unit, raw: s };
  }

  function parseTwitchSubDanish(text) {
    var tier = (text.match(/niveau\s+(\d+)/i) || [])[1];
    var months = (text.match(/abonneret\s+i\s+(\d+)\s+måneder/i) || [])[1];
    var streak = (text.match(/(\d+)\.\s*måned\s+i\s+træk/i) || [])[1];
    return {
      tier: tier ? parseInt(tier, 10) : null,
      months: months ? parseInt(months, 10) : null,
      streak: streak ? parseInt(streak, 10) : null
    };
  }

  function parseStreakMilestone(text) {
    var m = text.match(/stime\s+på\s+(\d+)\s+streams/i);
    return m ? { milestone: 'viewer_streak', streak_count: parseInt(m[1], 10) } : null;
  }

  function parseTwitchGiftSubDanish(text) {
    /* two phrasings observed:
       "X forærede et abonnement på niveau N til Y i kanalen tilhørende Z og har dermed givet K gaveabonnementer"
       "X gav et niveau N-abonnement til Y! Vedkommende har givet K gaveabonnementer ..." */
    var giftA = text.match(/forærede\s+et\s+abonnement\s+på\s+niveau\s+(\d+)\s+til\s+(\S+?)\s/i);
    var giftB = text.match(/gav\s+et\s+niveau\s+(\d+)-abonnement\s+til\s+([^\s!]+)/i);
    if (!giftA && !giftB) return null;
    var m = giftA || giftB;
    var totalMatch = text.match(/givet\s+(\d+)\s+gaveabonnement/i);
    return {
      tier: parseInt(m[1], 10),
      recipient: m[2],
      gifter_total: totalMatch ? parseInt(totalMatch[1], 10) : null
    };
  }

  function parseTwitchRaidDanish(text) {
    /* Two phrasings observed:
       A) "X er på et raid sammen med en gruppe på N."
       B) "X raider kanalen tilhørende Y med en fest, der har N gæster."
          (shared-chat / cross-channel raid wrapping; arrives on Twitch event:true) */
    var a = text.match(/er\s+på\s+et\s+raid\s+sammen\s+med\s+en\s+gruppe\s+på\s+(\d+)/i);
    if (a) return { viewer_count: parseInt(a[1], 10) };
    var b = text.match(/\braider\b[^\d]*?(\d+)\s+gæster/i);
    if (b) return { viewer_count: parseInt(b[1], 10) };
    return null;
  }

  function parseTikTokGift(html) {
    var text = stripHtml(html);
    var m = text.match(/har\s+sendt\s+(.+?)\s+x\s+(\d+)/i);
    if (!m) return { gift_name: null, count: 1, raw_text: text };
    return { gift_name: m[1].trim(), count: parseInt(m[2], 10), raw_text: text };
  }

  function userFromPayload(p) {
    return {
      name: p.chatname || '',
      avatar: p.chatimg || '',
      color: p.nameColor || '',
      badges: p.chatbadges || [],
      vip: !!p.vip,
      membership: p.membership || ''
    };
  }

  /* Returns null (skip), a single canonical event, or array (e.g. one viewer_update per platform). */
  function normalize(entry, opts) {
    opts = opts || {};
    var giftLookup = opts.giftLookup || {};
    var p = entry.payload || {};
    var ts = p.timestamp || entry.ts;
    var platform = entry.platform === 'unknown' ? (p.type || 'unknown') : entry.platform;
    var base = {
      timestamp: ts,
      iso: entry.iso,
      platform: platform,
      id: p.id,
      raw_event: p.event,
      raw: p
    };

    if (p.event === 'viewer_updates' || p.event === 'viewer_update') {
      var meta = p.meta || {};
      return Object.keys(meta).map(function (plat) {
        return Object.assign({}, base, {
          type: 'viewer_update',
          platform: plat,
          user: null,
          amount: { value: meta[plat], unit: 'viewers', raw: String(meta[plat]) },
          message: { text: '', html: '' },
          meta: { count: meta[plat] }
        });
      });
    }

    if (p.delete) {
      return Object.assign({}, base, {
        type: 'delete',
        platform: p.delete.type || platform,
        user: { name: p.delete.chatname || '' },
        message: { text: '', html: '' },
        meta: { only_last: !!p.delete.onlyLast }
      });
    }

    /* --- SSN canonical event names (Preview/Test panel + modern sources).
       These are platform-agnostic strings that fire across twitch/youtube/tiktok.
       They take precedence over the legacy event:true Danish-text path so the
       SSN test buttons + any source emitting canonical names are caught first.
       Verified shapes from the SSN test-panel capture 2026-05-08 (35 events,
       5 buttons × 2 clicks × 3 platforms + 5 viewer pings). */
    if (p.event === 'new_follower') {
      return Object.assign({}, base, {
        type: 'follow',
        user: userFromPayload(p),
        message: { text: stripHtml(p.chatmessage || ''), html: p.chatmessage || '' },
        meta: {}
      });
    }
    if (p.event === 'new_subscriber') {
      return Object.assign({}, base, {
        type: 'sub',
        user: userFromPayload(p),
        message: { text: stripHtml(p.chatmessage || ''), html: p.chatmessage || '' },
        meta: {
          membership: p.membership || '',
          subtitle: p.subtitle || ''
        }
      });
    }
    /* Direct-channel resub (English locale). SSN delivers a string `event: 'resub'`
       distinct from both the canonical `new_subscriber` (first-time subs) and the
       legacy Twitch shared-chat `event:true` Danish-text path. Without this branch
       resubs fall through to 'unknown' and get dropped. Verified 2026-05-20 from
       Ondal1's 12-month resub in the prWL6tHT7H capture. Format:
         "<name> subscribed at Tier N. They've subscribed for M months! - <message>"
       The trailing "- <message>" only appears if the user shared a resub message. */
    if (p.event === 'resub' || p.event === 'sub') {
      var subText = stripHtml(p.chatmessage || '');
      var m = subText.match(/^\S+\s+subscribed\s+at\s+Tier\s+(\d+)[.!]?(?:\s+They(?:'|&#39;)ve\s+subscribed\s+for\s+(\d+)\s+months?!?)?(?:\s+[-–]\s+(.*))?$/i);
      var subTier = m && m[1] ? parseInt(m[1], 10) : null;
      var subMonths = m && m[2] ? parseInt(m[2], 10) : null;
      var subUserMsg = m && m[3] ? m[3].trim() : '';
      var subType = (p.event === 'resub' || (subMonths && subMonths > 1)) ? 'resub' : 'sub';
      return Object.assign({}, base, {
        type: subType,
        user: userFromPayload(p),
        /* Only carry the user's shared resub message in `text`. Boilerplate
           ("X subscribed at Tier N. They've subscribed for M months!") is fully
           captured by meta.tier + meta.months and would just duplicate the label.
           Body-line renderer (allowlist) shows text only when non-empty. */
        message: { text: subUserMsg, html: p.chatmessage || '' },
        meta: {
          tier: subTier,
          months: subMonths,
          membership: p.membership || ''
        }
      });
    }
    if (p.event === 'cheer') {
      /* Twitch bits / YT cheers / TikTok diamond bundle. meta.bits is canonical. */
      var bits = (p.meta && p.meta.bits) || null;
      return Object.assign({}, base, {
        type: 'cheer',
        user: userFromPayload(p),
        amount: parseDonation(p.hasDonation) || (bits ? { value: bits, unit: 'bits', raw: String(bits) } : null),
        message: { text: stripHtml(p.chatmessage || ''), html: p.chatmessage || '' },
        meta: { bits: bits }
      });
    }
    if (p.event === 'raid' && p.meta && typeof p.meta === 'object') {
      /* Canonical raid — meta.viewers carries the count; chatname is the raider.
         Distinct from the legacy Danish-text raid (event:true) which we still
         handle further down. */
      var canonViewers = p.meta.viewers || null;
      return Object.assign({}, base, {
        type: 'raid',
        user: userFromPayload(p),
        amount: canonViewers != null ? { value: canonViewers, unit: 'viewers', raw: String(canonViewers) } : null,
        message: { text: stripHtml(p.chatmessage || ''), html: p.chatmessage || '' },
        meta: { viewer_count: canonViewers }
      });
    }
    if (p.event === 'donation') {
      /* Canonical donation / super chat. Twitch + YouTube use this; TikTok routes
         through event:'gift' instead. donoValue is numeric; hasDonation has currency. */
      return Object.assign({}, base, {
        type: 'donation',
        user: userFromPayload(p),
        amount: parseDonation(p.hasDonation),
        message: { text: stripHtml(p.chatmessage || ''), html: p.chatmessage || '' },
        meta: {
          dono_value: typeof p.donoValue === 'number' ? p.donoValue : null,
          title: p.title || ''
        }
      });
    }

    if (p.event === 'community_highlight') {
      var fragments = Array.isArray(p.meta) ? p.meta : [];
      var uniqFragments = [];
      fragments.forEach(function (f) { if (uniqFragments.indexOf(f) === -1) uniqFragments.push(f); });
      return Object.assign({}, base, {
        type: 'highlight',
        user: null,
        message: { text: uniqFragments.join(' '), html: '' },
        meta: { fragments: uniqFragments }
      });
    }

    /* Twitch channel-point reward redemption (DOM-scrape path). Verified 2026-05-15:
       SSN delivers these even in Standard mode (e.g. HaniSkilzDK [SFX] Knock).
       Without this handler the reward falls through to 'unknown' and gets dropped. */
    if (entry.platform === 'twitch' && p.event === 'reward') {
      var rewardText = stripHtml(p.chatmessage || '');
      var rewardTitle = (p.meta && (p.meta.reward || p.meta.title)) || rewardText;
      return Object.assign({}, base, {
        type: 'reward',
        user: userFromPayload(p),
        message: { text: rewardText, html: p.chatmessage || '' },
        meta: { reward: rewardTitle, cost: (p.meta && p.meta.cost) || null }
      });
    }

    /* Modern SSN TikTok DOM scraper emits canonical string events instead of
       the legacy event:true + Danish-text path. Handle them directly so we
       don't depend on the heuristic eventHints fallback. The event:true
       block below still runs as a safety net when eventHints can't classify. */
    if (entry.platform === 'tiktok' && (p.event === 'joined' || p.event === 'followed' || p.event === 'shared' || p.event === 'subscribe' || p.event === 'envelope')) {
      var ttCanonType = { joined: 'join', followed: 'follow', shared: 'share', subscribe: 'sub', envelope: 'system' }[p.event];
      return Object.assign({}, base, {
        type: ttCanonType,
        user: userFromPayload(p),
        message: { text: stripHtml(p.chatmessage || ''), html: p.chatmessage || '' },
        meta: p.event === 'envelope' ? { coins: (p.meta && p.meta.coins) || null } : {}
      });
    }

    if (entry.platform === 'twitch' && p.event === true) {
      var rawText = stripHtml(p.chatmessage || '');
      var raid = parseTwitchRaidDanish(rawText);
      if (raid) {
        /* Shared-chat raid (variant B): chatname is empty; raider's name is the
           first token of the message. Extract it so the activity feed has a
           user to display. Example: "CoachDP raider kanalen tilhørende ..." */
        var raidUser = userFromPayload(p);
        if (!raidUser.name) {
          /* No ^ anchor — stripHtml prepends img alt text (the source channel name)
             before the raider's name. We want the token immediately preceding "raider". */
          var nameMatch = rawText.match(/(\S+)\s+raider\b/i);
          if (nameMatch) raidUser.name = nameMatch[1];
        }
        var sourceMatch = rawText.match(/tilhørende\s+(\S+?)\s+med\b/i);
        if (sourceMatch) raid.source_channel = sourceMatch[1];
        return Object.assign({}, base, {
          type: 'raid',
          user: raidUser,
          amount: { value: raid.viewer_count, unit: 'viewers', raw: rawText },
          message: { text: rawText, html: p.chatmessage || '' },
          meta: raid
        });
      }
      var giftSub = parseTwitchGiftSubDanish(rawText);
      if (giftSub) {
        return Object.assign({}, base, {
          type: 'gift_sub',
          user: userFromPayload(p),
          message: { text: rawText, html: p.chatmessage || '' },
          meta: giftSub
        });
      }
      var milestone = parseStreakMilestone(rawText);
      if (milestone) {
        return Object.assign({}, base, {
          type: 'system',
          user: userFromPayload(p),
          message: { text: rawText, html: p.chatmessage || '' },
          meta: milestone
        });
      }
      var sub = parseTwitchSubDanish(rawText);
      /* Guard: don't emit sub/resub unless there's actual evidence (parsed fields
         OR sub keywords). Twitch event:true also fires for system/integration
         messages (Spotify-bot announcements, channel-point alerts, etc.) which
         previously fell through to a phantom "sub" render. */
      var looksLikeSub = sub.tier || sub.months || sub.streak
        || /\babonn|niveau\s+\d|abonnement/i.test(rawText);
      if (looksLikeSub) {
        var subType = (sub.months && sub.months > 1) ? 'resub' : 'sub';
        return Object.assign({}, base, {
          type: subType,
          user: userFromPayload(p),
          message: { text: rawText, html: p.chatmessage || '' },
          meta: { tier: sub.tier, months: sub.months, streak: sub.streak }
        });
      }
      /* Uncategorized Twitch event:true (Spotify-bot announcements, etc.) — drop.
         Re-enable by changing this to a 'system' return if you need visibility. */
      return null;
    }

    if (entry.platform === 'tiktok' && p.event === true) {
      var ttext = stripHtml(p.chatmessage || '');
      var lower = ttext.toLowerCase();
      /* TikTok delivers high-frequency events as event:true + chatmessage describing the action.
         Patterns derived 2026-05-06 from steveseguin/social_stream/sources/tiktok.js — covers
         EN + DK localizations. Validate on next captured stream and tighten if needed. */
      /* follow: "følger værten" (DK) / "followed the host" / "is following the host" */
      if (/følger\s+værten/.test(lower) || /follow(?:ed|ing)\s+the\s+host/.test(lower)) {
        return Object.assign({}, base, {
          type: 'follow',
          user: userFromPayload(p),
          message: { text: ttext, html: p.chatmessage || '' },
          meta: {}
        });
      }
      /* like: "X liked" / "X synes godt om" — high-volume, user-streakable */
      if (/\bliked\b/.test(lower) || /synes\s+godt\s+om/.test(lower)) {
        return Object.assign({}, base, {
          type: 'like',
          user: userFromPayload(p),
          message: { text: ttext, html: p.chatmessage || '' },
          meta: {}
        });
      }
      /* join: "joined" (EN) / "deltager" (DK, lit. "is participating") — pinned ticker */
      if (/\bjoined\b/.test(lower) || /\bdeltager\b/.test(lower)) {
        return Object.assign({}, base, {
          type: 'join',
          user: userFromPayload(p),
          message: { text: ttext, html: p.chatmessage || '' },
          meta: {}
        });
      }
      /* share: "shared" (EN) / "delte" (DK) */
      if (/\bshared\b/.test(lower) || /\bdelte\b/.test(lower)) {
        return Object.assign({}, base, {
          type: 'share',
          user: userFromPayload(p),
          message: { text: ttext, html: p.chatmessage || '' },
          meta: {}
        });
      }
      return Object.assign({}, base, {
        type: 'system',
        user: userFromPayload(p),
        message: { text: ttext, html: p.chatmessage || '' },
        meta: {}
      });
    }

    /* TikTok likes arrive as event:'liked' (string), NOT event:true. The chatmessage
       is "har liket denne LIVE". Streak-grouped per-user in the dock. */
    if (entry.platform === 'tiktok' && p.event === 'liked') {
      return Object.assign({}, base, {
        type: 'like',
        user: userFromPayload(p),
        message: { text: stripHtml(p.chatmessage || ''), html: p.chatmessage || '' },
        meta: {}
      });
    }

    if (entry.platform === 'tiktok' && p.event === 'gift') {
      /* Two text formats observed:
           DK live: "har sendt Rose x 100"  → parsed by regex
           EN test: "Sent Rose x100"        → no regex match; use p.title field
         Prefer p.title when present (cleaner, no parsing). Also accept hasDonation
         "100 Diamonds" as a coin amount for the canonical test-panel events. */
      var gift = parseTikTokGift(p.chatmessage || '');
      if (!gift.gift_name && p.title) {
        gift.gift_name = String(p.title).trim();
        var countMatch = (p.chatmessage || '').match(/x\s*(\d+)/i);
        gift.count = countMatch ? parseInt(countMatch[1], 10) : 1;
      }
      var nameKey = (gift.gift_name || '').toLowerCase();
      var coins = nameKey && giftLookup[nameKey];
      coins = (typeof coins === 'number') ? coins : null;
      /* Fallback: SSN's canonical gift carries hasDonation "N Diamonds" — parse it. */
      var amountFromHasDonation = null;
      if (coins == null && p.hasDonation) {
        var dm = String(p.hasDonation).match(/(\d[\d,.]*)\s*diamond/i);
        if (dm) amountFromHasDonation = parseInt(dm[1].replace(/[,.]/g, ''), 10);
      }
      return Object.assign({}, base, {
        type: 'gift',
        user: userFromPayload(p),
        amount: coins != null
          ? { value: coins * gift.count, unit: 'coins', raw: gift.gift_name + ' x ' + gift.count }
          : amountFromHasDonation != null
            ? { value: amountFromHasDonation, unit: 'coins', raw: p.hasDonation }
            : { value: null, unit: 'unknown', raw: (gift.gift_name || '?') + ' x ' + gift.count },
        message: { text: gift.raw_text || stripHtml(p.chatmessage || ''), html: p.chatmessage || '' },
        meta: { gift_name: gift.gift_name, count: gift.count, gift_unmapped: coins == null && amountFromHasDonation == null }
      });
    }

    if (p.event === 'donation' || (entry.kind === 'event' && p.hasDonation)) {
      var donationType = platform === 'youtubeshorts' ? 'hearts' : 'donation';
      return Object.assign({}, base, {
        type: donationType,
        user: userFromPayload(p),
        amount: parseDonation(p.hasDonation),
        message: { text: stripHtml(p.chatmessage || ''), html: p.chatmessage || '' },
        meta: { membership: p.membership || '' }
      });
    }

    /* Plain message: kind=chat, or anywhere with chatmessage and no recognized event marker.
       Catches discord/facebook/slack (no event field at all) and Twitch shared-chat messages
       (event === ""). */
    if (entry.kind === 'chat' || (!p.event && p.chatmessage)) {
      var sharedSubtitle = (entry.platform === 'twitch' && p.subtitle) ? p.subtitle : null;
      return Object.assign({}, base, {
        type: 'message',
        user: Object.assign(userFromPayload(p), { isShared: !!sharedSubtitle }),
        message: { text: stripHtml(p.chatmessage || ''), html: p.chatmessage || '' },
        meta: sharedSubtitle ? { source_channel_subtitle: sharedSubtitle } : {}
      });
    }

    if (p.event === 'test') {
      return Object.assign({}, base, {
        type: 'test',
        user: userFromPayload(p),
        message: { text: stripHtml(p.chatmessage || ''), html: p.chatmessage || '' },
        meta: {}
      });
    }

    return Object.assign({}, base, {
      type: 'unknown',
      user: userFromPayload(p),
      message: { text: stripHtml(p.chatmessage || ''), html: p.chatmessage || '' },
      meta: {}
    });
  }

  function normalizeAll(entries, opts) {
    var out = [];
    var unmappedGifts = {};
    var typeCounts = {};
    for (var i = 0; i < entries.length; i++) {
      var n = normalize(entries[i], opts);
      if (!n) continue;
      var arr = Array.isArray(n) ? n : [n];
      for (var j = 0; j < arr.length; j++) {
        var ev = arr[j];
        out.push(ev);
        typeCounts[ev.type] = (typeCounts[ev.type] || 0) + 1;
        if (ev.type === 'gift' && ev.meta && ev.meta.gift_unmapped) {
          var k = (ev.meta.gift_name || '__null__').toLowerCase();
          unmappedGifts[k] = (unmappedGifts[k] || 0) + 1;
        }
      }
    }
    return { events: out, unmappedGifts: unmappedGifts, typeCounts: typeCounts };
  }

  var api = {
    normalize: normalize,
    normalizeAll: normalizeAll,
    _internals: {
      stripHtml: stripHtml,
      parseTwitchSubDanish: parseTwitchSubDanish,
      parseTikTokGift: parseTikTokGift,
      parseDonation: parseDonation,
      parseStreakMilestone: parseStreakMilestone
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SSNNormalize = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
