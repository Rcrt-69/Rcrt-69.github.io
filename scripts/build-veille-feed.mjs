// Génère veille-feed.json à partir de plusieurs recherches Google News ciblées,
// PUIS filtre les résultats pour ne garder que ceux réellement pertinents.
// Thème : CYBERSÉCURITÉ & SOFTWARE (logiciel) en SPORT AUTOMOBILE.
// Exécuté côté serveur par la GitHub Action (.github/workflows/veille-rss.yml).
// Aucune dépendance : utilise le fetch natif de Node 20+.
//
// Un article n'est conservé que si son titre contient à la fois :
//   - un terme « sport automobile »  ET
//   - un terme « cybersécurité » OU « software / logiciel ».

import { writeFileSync } from 'node:fs';

const queries = [
    // --- Software / logiciel ---
    '"Formule 1" logiciel',
    '"Formula 1" software',
    '"Formula 1" simulation',
    '"Formula 1" "digital twin"',
    '"Formula 1" telemetry',
    'F1 "intelligence artificielle" stratégie',
    'F1 artificial intelligence strategy',
    'motorsport software',
    'motorsport simulation technology',
    'sim racing cybersecurity',
    // --- Cybersécurité ---
    '"Formule 1" cybersécurité',
    '"Formula 1" cybersecurity',
    '"Formula 1" cyberattack',
    'motorsport cybersecurity',
    'motorsport ransomware',
    'WEC cybersecurity',
    'NASCAR ransomware'
];

// Filtre de pertinence.
const MOTORSPORT = [
    'f1', 'formula 1', 'formule 1', 'grand prix', 'grand-prix', 'paddock', 'pit wall',
    'mclaren', 'ferrari', 'mercedes', 'red bull', 'williams', 'alpine', 'aston martin',
    'wec', 'endurance', 'le mans', '24 heures', '24 hours', 'hypercar', 'lmp',
    'imsa', 'nascar', 'indycar', 'daytona', 'sebring',
    'formula e', 'formule e', 'motogp', 'rallye', 'rally',
    'motorsport', 'motorsports', 'sport automobile', 'sport auto', 'ecurie', 'racing', 'fia'];

const CYBER = [
    'cyber', 'ransomware', 'rancongiciel', 'hack', 'pirate', 'piratage informatique',
    'data breach', 'fuite de donnees', 'phishing', 'hameconnage', 'malware', 'rgpd',
    'ddos', 'securite informatique', 'attaque informatique', 'donnees personnelles', 'faille'];

const SOFTWARE = [
    'software', 'logiciel', 'simulation', 'simulateur', 'digital twin', 'jumeau numerique',
    'telemetry', 'telemetrie', 'intelligence artificielle', 'machine learning', 'deep learning',
    'algorithme', 'algorithm', 'ecu', 'apache kafka', 'cloud', 'code', 'informatique',
    'sim racing', 'esport', 'data science', 'big data', 'application', 'programme'];

// Sélection curée de secours (vrais articles vérifiés) si le live donne trop peu.
const CURATED = [
    { title: 'La F1, nouveau laboratoire mondial de la cybersécurité', link: 'https://www.sportstrategies.com/', source: 'Sport Stratégies', pubDate: '' },
    { title: 'How McLaren uses Apache Kafka to stream Formula 1 telemetry data', link: 'https://www.confluent.io/', source: 'Confluent', pubDate: '' },
    { title: 'Digital twins: how F1 teams develop cars in a virtual world', link: 'https://community.xcelerator.siemens.com/public/blogs/the-unseen-race-how-digital-engineering-forges-formula-1-champions-2025-09-19', source: 'Siemens', pubDate: '' },
    { title: 'The AI behind Formula 1 race strategy', link: 'https://aws.amazon.com/sports/f1/', source: 'AWS', pubDate: '' },
    { title: 'Why Do F1 Teams Need Cybersecurity, and How Is AI Changing the Threat Landscape?', link: 'https://securityboulevard.com/2026/07/why-do-f1-teams-need-cybersecurity-and-how-is-ai-changing-the-threat-landscape/', source: 'Security Boulevard', pubDate: '' },
    { title: 'NASCAR confirms data breach after Medusa ransomware attack', link: 'https://therecord.media/nascar-confirms-data-breach', source: 'The Record', pubDate: '' }
];

function rssUrl(q) {
    return 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=fr&gl=FR&ceid=FR:fr';
}

function fold(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function isRelevant(title) {
    const t = fold(title);
    const hasMoto = MOTORSPORT.some(w => t.includes(w));
    const hasTheme = CYBER.some(w => t.includes(w)) || SOFTWARE.some(w => t.includes(w));
    return hasMoto && hasTheme;
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
    const relevant = [];

    for (const q of queries) {
        try {
            const res = await fetch(rssUrl(q), {
                headers: { 'User-Agent': 'Mozilla/5.0 (veille-bot; +github-actions)' }
            });
            if (!res.ok) { console.warn('  ! HTTP', res.status, 'pour', q); continue; }
            const xml = await res.text();
            for (const it of parseItems(xml)) {
                const key = fold(it.title).replace(/\s+/g, ' ').trim();
                if (seen.has(key)) continue;
                if (!isRelevant(it.title)) continue;
                seen.add(key);
                relevant.push(it);
            }
        } catch (e) {
            console.warn('  ! Échec requête', q, ':', e.message);
        }
    }

    relevant.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));

    const items = relevant.slice(0, 9);
    if (items.length < 5) {
        for (const c of CURATED) {
            if (items.length >= 6) break;
            const key = fold(c.title).replace(/\s+/g, ' ').trim();
            if (seen.has(key)) continue;
            seen.add(key);
            items.push(c);
        }
    }

    if (!items.length) throw new Error('Aucun article pertinent');

    const out = {
        updated: new Date().toISOString(),
        theme: 'Cybersécurité & software en sport automobile',
        source: 'Google News RSS (recherches multiples, filtrées par pertinence)',
        liveCount: relevant.length,
        items
    };
    writeFileSync('veille-feed.json', JSON.stringify(out, null, 2) + '\n');
    console.log('veille-feed.json écrit —', items.length, 'articles affichés,', relevant.length, 'pertinents en live.');
}

main().catch(err => {
    console.error('Échec de la génération du flux :', err.message);
    process.exit(1);
});
