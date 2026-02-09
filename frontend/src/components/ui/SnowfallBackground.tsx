import { useTheme } from '../../contexts/ThemeContext'
import snowfallLight from '../../assets/snowfall-light.gif'
import snowfallDark from '../../assets/snowfall-dark.gif'

export default function SnowfallBackground() {
  const { resolvedTheme } = useTheme()
  const snowfallGif = resolvedTheme === 'dark' ? snowfallDark : snowfallLight

  return (
    <div
      className="fixed inset-0 -z-10 pointer-events-none"
      style={{
        backgroundImage: `url(${snowfallGif})`,
        backgroundRepeat: 'repeat',
        backgroundSize: 'auto',
        opacity: 0.3,
      }}
    />
  )
}
