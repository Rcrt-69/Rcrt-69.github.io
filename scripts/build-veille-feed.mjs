// Génère veille-feed.json à partir de plusieurs recherches Google News ciblées.
// Exécuté côté serveur par la GitHub Action (.github/workflows/veille-rss.yml).
// Aucune dépendance : utilise le fetch natif de Node 20+.
//
// Principe : plutôt qu'une seule grosse requête booléenne (que Google News
// interprète mal), on lance plusieurs recherches « phrase exacte + terme cyber ».
// Chaque résultat contient donc forcément un terme de cybersécurité ET une
// référence à la F1 / au sport auto : le flux reste pertinent.

import { writeFileSync } from 'node:fs';

const queries = [
    '"Formule 1" cybersécurité',
    '"Formule 1" cyberattaque',
    '"Formule 1" rançongiciel',
    '"Formula 1" cybersecurity',
    '"Formula 1" cyberattack',
    '"Formula 1" ransomware',
    '"Formula 1" "data breach"',
    'motorsport cybersecurity',
    'WEC cybersecurity'
];

function rssUrl(q) {
    return 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=fr&gl=FR&ceid=FR:fr';
}

function decode(s) {
    return String(s)
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/<[^>]+>/g, '')
        .trim();
}

function pick(block, re) {
    const m = re.exec(block);
    return m ? decode(m[1]) : '';
}

function parseItems(xml) {
    const items = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRe.exec(xml))) {
        const block = m[1];
        let title = pick(block, /<title>([\s\S]*?)<\/title>/);
        const link = pick(block, /<link>([\s\S]*?)<\/link>/);
        const pubDate = pick(block, /<pubDate>([\s\S]*?)<\/pubDate>/);
        const source = pick(block, /<source[^>]*>([\s\S]*?)<\/source>/);
        if (source && title.endsWith(' - ' + source)) {
            title = title.slice(0, -(source.length + 3)).trim();
        }
        if (title && link) items.push({ title, link, source, pubDate });
    }
    return items;
}

async function main() {
    const seen = new Set();
    const all = [];

    for (const q of queries) {
        try {
            const res = await fetch(rssUrl(q), {
                headers: { 'User-Agent': 'Mozilla/5.0 (veille-bot; +github-actions)' }
            });
            if (!res.ok) { console.warn('  ! HTTP', res.status, 'pour', q); continue; }
            const xml = await res.text();
            for (const it of parseItems(xml)) {
                const key = it.title.toLowerCase().replace(/\s+/g, ' ').trim();
                if (seen.has(key)) continue;
                seen.add(key);
                all.push(it);
            }
        } catch (e) {
            console.warn('  ! Échec requête', q, ':', e.message);
        }
    }

    if (!all.length) throw new Error('Aucun article extrait des flux');

    // Tri par date décroissante (les articles sans date passent en dernier).
    all.sort((a, b) => {
        const da = Date.parse(a.pubDate) || 0;
        const db = Date.parse(b.pubDate) || 0;
        return db - da;
    });

    const items = all.slice(0, 8);
    const out = {
        updated: new Date().toISOString(),
        query: queries.join(' | '),
        source: 'Google News RSS (recherches multiples fusionnées)',
        items
    };
    writeFileSync('veille-feed.json', JSON.stringify(out, null, 2) + '\n');
    console.log('veille-feed.json écrit —', items.length, 'articles (sur', all.length, 'uniques trouvés).');
}

main().catch(err => {
    console.error('Échec de la génération du flux :', err.message);
    process.exit(1);
});
