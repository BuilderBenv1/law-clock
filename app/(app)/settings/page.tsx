import { getSettings, localeOf } from '@/lib/settings';
import { t } from '@/lib/i18n';
import { updateSettings, sendMonthlyNow, addAppUser, removeAppUser } from '@/lib/actions';
import { prevMonthKey } from '@/lib/time';
import { getDb } from '@/lib/db';
import { appUsers } from '@/lib/db/schema';
import { LogoUpload } from '@/components/logo-upload';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const s = await getSettings();
  const locale = localeOf(s);
  const defaultMonth = prevMonthKey(new Date(), s.timezone);
  const users = await getDb().select().from(appUsers).orderBy(appUsers.createdAt);

  return (
    <div className="space-y-8 max-w-2xl">
      <h1 className="text-2xl font-semibold">{t(locale, 'settings')}</h1>

      <form action={updateSettings} className="card grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2 text-sm font-medium text-slate-300">{t(locale, 'firmName')}</div>
        <div className="md:col-span-2">
          <label className="label">{t(locale, 'firmName')}</label>
          <input name="firmName" className="input" defaultValue={s.firmName} />
        </div>
        <div>
          <label className="label">{t(locale, 'firmEmail')}</label>
          <input name="firmEmail" type="email" className="input" defaultValue={s.firmEmail ?? ''} />
        </div>
        <div>
          <label className="label">{t(locale, 'firmPhone')}</label>
          <input name="firmPhone" className="input" defaultValue={s.firmPhone ?? ''} />
        </div>
        <div className="md:col-span-2">
          <label className="label">{t(locale, 'firmAddress')}</label>
          <input name="firmAddress" className="input" defaultValue={s.firmAddress ?? ''} />
        </div>
        <div>
          <label className="label">{t(locale, 'taxId')}</label>
          <input name="taxId" className="input" defaultValue={s.taxId ?? ''} />
        </div>
        <div>
          <label className="label">{t(locale, 'reportEmail')}</label>
          <input name="reportEmail" type="email" className="input" defaultValue={s.reportEmail ?? ''} placeholder="reports@..." />
        </div>

        <LogoUpload locale={locale} initial={s.logoUrl} />

        <div className="md:col-span-2 border-t border-slate-800 pt-4 text-sm font-medium text-slate-300">
          {t(locale, 'defaultHourlyRate')} · {t(locale, 'currency')}
        </div>
        <div>
          <label className="label">{t(locale, 'defaultHourlyRate')}</label>
          <input name="defaultHourlyRate" type="number" step="0.01" min="0" className="input" defaultValue={s.defaultHourlyRate} />
        </div>
        <div>
          <label className="label">{t(locale, 'currency')}</label>
          <input name="defaultCurrency" className="input" defaultValue={s.defaultCurrency} />
        </div>
        <div>
          <label className="label">{t(locale, 'roundIncrement')}</label>
          <input name="roundIncrementMin" type="number" step="1" min="1" className="input" defaultValue={s.roundIncrementMin} />
        </div>
        <div>
          <label className="label">{t(locale, 'vatRateLabel')}</label>
          <input name="vatRate" type="number" step="0.1" min="0" className="input" defaultValue={s.vatRate} />
        </div>
        <div>
          <label className="label">{t(locale, 'timezone')}</label>
          <input name="timezone" className="input" defaultValue={s.timezone} />
        </div>
        <div>
          <label className="label">{t(locale, 'language')}</label>
          <select name="locale" className="input" defaultValue={s.locale}>
            <option value="he">עברית</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="autoSendMonthly" value="1" defaultChecked={s.autoSendMonthly === 1} className="w-4 h-4" />
            {t(locale, 'autoSendMonthly')}
          </label>
        </div>

        <div className="md:col-span-2">
          <button className="btn-primary" type="submit">
            {t(locale, 'save')}
          </button>
        </div>
      </form>

      {/* Send a month's report now */}
      <form action={sendMonthlyNow} className="card flex items-end gap-3 flex-wrap">
        <div>
          <label className="label">{t(locale, 'month')}</label>
          <input name="monthKey" type="month" className="input" defaultValue={defaultMonth} />
        </div>
        <button className="btn-ghost" type="submit">
          {locale === 'he' ? 'שלח דוח חודשי עכשיו' : 'Send monthly report now'}
        </button>
        <p className="text-xs text-slate-500 w-full">
          {locale === 'he'
            ? 'הדוח נשלח לכתובת שהוגדרה לקבלת דוחות חודשיים, עם קובץ CSV מצורף.'
            : 'Sent to the configured report email, with a CSV attached.'}
        </p>
      </form>

      {/* Who can sign in — beyond OWNER_EMAIL, managed here without redeploying. */}
      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">{t(locale, 'users')}</h2>
          <p className="text-xs text-slate-500">{t(locale, 'usersHelp')}</p>
        </div>
        {users.length > 0 ? (
          <ul className="space-y-2">
            {users.map((u) => (
              <li key={u.id} className="flex items-center justify-between text-sm border-b border-slate-800 pb-2">
                <span>
                  {u.name ? <span className="font-medium">{u.name} · </span> : null}
                  <span className="text-slate-400">{u.email}</span>
                </span>
                <form action={removeAppUser}>
                  <input type="hidden" name="id" value={u.id} />
                  <button type="submit" className="text-slate-500 hover:text-red-400 text-xs" title={t(locale, 'delete')}>
                    ✕
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
        <form action={addAppUser} className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="label">{t(locale, 'email')}</label>
            <input name="email" type="email" className="input" placeholder="colleague@gmail.com" required />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="label">{t(locale, 'name')}</label>
            <input name="name" className="input" />
          </div>
          <button className="btn-primary" type="submit">
            ＋ {t(locale, 'addUser')}
          </button>
        </form>
      </section>
    </div>
  );
}
