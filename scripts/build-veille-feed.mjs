// Génère veille-feed.json à partir de plusieurs recherches Google News ciblées,
// PUIS filtre les résultats pour ne garder que ceux réellement pertinents.
// Exécuté côté serveur par la GitHub Action (.github/workflows/veille-rss.yml).
// Aucune dépendance : utilise le fetch natif de Node 20+.
//
// Google News fait du matching approximatif sur ce sujet de niche : on applique
// donc un FILTRE DE PERTINENCE déterministe — un article n'est conservé que si
// son titre contient à la fois un terme « sport auto » ET un terme « cyber ».
// Si trop peu d'articles passent le filtre, on complète avec une sélection curée.

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

// Filtre de pertinence : le titre doit contenir un terme de CHAQUE liste.
const MOTORSPORT = ['f1', 'formula 1', 'formule 1', 'grand prix', 'grand-prix', 'paddock',
    'wec', 'endurance', 'le mans', 'motorsport', 'sport automobile', 'ecurie', 'pit wall',
    'mclaren', 'ferrari', 'mercedes', 'red bull', 'williams', 'alpine', 'aston martin', 'racing'];
const CYBER = ['cyber', 'ransomware', 'rancongiciel', 'hack', 'piratage informatique', 'pirate',
    'data breach', 'fuite de donnees', 'phishing', 'hameconnage', 'malware', 'rgpd', 'ddos',
    'securite informatique', 'attaque informatique', 'donnees personnelles', 'faille'];

// Sélection curée de secours (vrais articles vérifiés), utilisée si le filtre
// laisse trop peu de résultats afin que la section ne soit jamais vide.
const CURATED = [
    { title: 'Cyber security in F1: McLaren and partner Darktrace explain crucial defences', link: 'https://www.skysports.com/f1/news/12433/13232063/cyber-security-in-f1-mclaren-and-partner-darktrace-explain-crucial-defences-supporting-lando-norris-title-challenge', source: 'Sky Sports F1', pubDate: '' },
    { title: 'Why Do F1 Teams Need Cybersecurity, and How Is AI Changing the Threat Landscape?', link: 'https://securityboulevard.com/2026/07/why-do-f1-teams-need-cybersecurity-and-how-is-ai-changing-the-threat-landscape/', source: 'Security Boulevard', pubDate: '' },
    { title: 'Ferrari Data Breach: Second Attack Within A Span Of Six Months', link: 'https://thecyberexpress.com/ferrari-data-breach-explained/', source: 'The Cyber Express', pubDate: '' },
    { title: 'Keeper Security Forges Cybersecurity Partnership With Williams Racing', link: 'https://www.keepersecurity.com/blog/2024/04/30/williams-racing-f1-sponsorship/', source: 'Keeper Security', pubDate: '' },
    { title: 'The Biggest Cyberattacks in F1 History', link: 'https://www.expressvpn.com/blog/formula-one-cyberthreats/', source: 'ExpressVPN', pubDate: '' },
    { title: 'Formula One: Accelerating Cybersecurity in Motorsport', link: 'https://techinformed.com/accelerating-cybersecurity-in-the-world-of-motorsport-formula-one/', source: 'TechInformed', pubDate: '' }
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
    const hasCyber = CYBER.some(w => t.includes(w));
    return hasMoto && hasCyber;
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

    // Tri par date décroissante.
    relevant.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));

    // Complément curé si le flux live donne trop peu de résultats pertinents.
    const items = relevant.slice(0, 8);
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
        query: queries.join(' | '),
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
