import GLib from 'gi://GLib';

export function translator(settings) {
    const language = settings.get_string('language');
    const vi = language === 'vi' || (language === 'auto' && GLib.get_language_names()[0].toLowerCase().startsWith('vi'));
    return (en, vietnamese) => vi ? vietnamese : en;
}
