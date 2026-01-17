import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import { useTranslation } from 'react-i18next'

export default function HeaderBar() {
  const { theme, setTheme } = useTheme()
  const { i18n } = useTranslation()

  const currentLang = i18n.language?.startsWith('zh') ? 'zh' : 'en'

  const setLanguage = (lang: 'en' | 'zh') => {
    i18n.changeLanguage(lang)
  }

  return (
    <div className="h-12 bg-surface border-b border-border flex items-center justify-end px-4 gap-3">
      {/* Language Toggle */}
      <div className="flex items-center gap-1 bg-surface-secondary rounded-lg p-1">
        <button
          onClick={() => setLanguage('en')}
          className={`px-2 py-1 rounded text-sm font-medium transition-colors ${
            currentLang === 'en'
              ? 'bg-primary text-white'
              : 'text-muted hover:text-foreground hover:bg-surface'
          }`}
          title="English"
        >
          EN
        </button>
        <button
          onClick={() => setLanguage('zh')}
          className={`px-2 py-1 rounded text-sm font-medium transition-colors ${
            currentLang === 'zh'
              ? 'bg-primary text-white'
              : 'text-muted hover:text-foreground hover:bg-surface'
          }`}
          title="中文"
        >
          中文
        </button>
      </div>

      {/* Theme Toggle */}
      <div className="flex items-center gap-1 bg-surface-secondary rounded-lg p-1">
        <button
          onClick={() => setTheme('light')}
          className={`p-1.5 rounded transition-colors ${
            theme === 'light'
              ? 'bg-primary text-white'
              : 'text-muted hover:text-foreground hover:bg-surface'
          }`}
          title="Light mode"
        >
          <Sun size={16} />
        </button>
        <button
          onClick={() => setTheme('dark')}
          className={`p-1.5 rounded transition-colors ${
            theme === 'dark'
              ? 'bg-primary text-white'
              : 'text-muted hover:text-foreground hover:bg-surface'
          }`}
          title="Dark mode"
        >
          <Moon size={16} />
        </button>
        <button
          onClick={() => setTheme('system')}
          className={`p-1.5 rounded transition-colors ${
            theme === 'system'
              ? 'bg-primary text-white'
              : 'text-muted hover:text-foreground hover:bg-surface'
          }`}
          title="System mode"
        >
          <Monitor size={16} />
        </button>
      </div>
    </div>
  )
}
