const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const output = path.join(root, 'dist');
const files = ['village.html', 'village.css', 'village.js'];
const images = ['login-village.png', 'village.jpg'];
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim();

if (Boolean(supabaseUrl) !== Boolean(supabaseAnonKey)) {
    throw new Error('Set both SUPABASE_URL and SUPABASE_ANON_KEY, or leave both unset.');
}

if (supabaseUrl && supabaseAnonKey) {
    let parsedSupabaseUrl;
    try {
        parsedSupabaseUrl = new URL(supabaseUrl);
    } catch (error) {
        throw new Error('SUPABASE_URL must be a valid HTTPS URL.');
    }
    if (parsedSupabaseUrl.protocol !== 'https:' || !parsedSupabaseUrl.hostname) {
        throw new Error('SUPABASE_URL must be a valid HTTPS URL.');
    }
    if (/^(sb_secret_|service_role)/i.test(supabaseAnonKey)) {
        throw new Error('SUPABASE_ANON_KEY must be a publishable/anon key, never a service-role secret.');
    }
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, 'image'), { recursive: true });

for (const file of files) {
    fs.copyFileSync(path.join(root, file), path.join(output, file));
}

fs.copyFileSync(path.join(root, 'village.html'), path.join(output, 'index.html'));

for (const image of images) {
    fs.copyFileSync(path.join(root, 'image', image), path.join(output, 'image', image));
}

fs.writeFileSync(
    path.join(output, 'supabase-config.js'),
    `window.VILLAGE_SUPABASE_CONFIG = ${supabaseUrl && supabaseAnonKey
        ? JSON.stringify({ url: supabaseUrl, anonKey: supabaseAnonKey })
        : 'null'};\n`
);

console.log(`Prepared ${files.length} site files and ${images.length} images in dist.`);
