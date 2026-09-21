// Génère veille-feed.json à partir du flux RSS Google News.
// Exécuté côté serveur par la GitHub Action (.github/workflows/veille-rss.yml).
// Aucune dépendance : utilise le fetch natif de Node 20+.

import { writeFileSync } from 'node:fs';

const query = '(Formula 1 OR F1 OR WEC) (cybersecurity OR cyberattack OR ransomware OR hack OR cybersécurité)';
const rssUrl = 'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=fr&gl=FR&ceid=FR:fr';

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

async function main() {
    const res = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (veille-bot; +github-actions)' } });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' sur le flux RSS');
    const xml = await res.text();

    const items = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRe.exec(xml)) && items.length < 8) {
        const block = m[1];
        let title = pick(block, /<title>([\s\S]*?)<\/title>/);
        const link = pick(block, /<link>([\s\S]*?)<\/link>/);
        const pubDate = pick(block, /<pubDate>([\s\S]*?)<\/pubDate>/);
        const source = pick(block, /<source[^>]*>([\s\S]*?)<\/source>/);
        // Google News formate le titre en « Titre - Source » : on retire le suffixe.
        if (source && title.endsWith(' - ' + source)) {
            title = title.slice(0, -(source.length + 3)).trim();
        }
        if (title && link) items.push({ title, link, source, pubDate });
    }

    if (!items.length) throw new Error('Aucun article extrait du flux');

    const out = {
        updated: new Date().toISOString(),
        query,
        source: 'Google News RSS',
        items
    };
    writeFileSync('veille-feed.json', JSON.stringify(out, null, 2) + '\n');
    console.log('veille-feed.json écrit —', items.length, 'articles.');
}

main().catch(err => {
    console.error('Échec de la génération du flux :', err.message);
    process.exit(1);
});
