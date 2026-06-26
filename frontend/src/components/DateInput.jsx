import { useRef, useState, useEffect } from 'react'

export default function DateInput({ value, onChange, className = 'form-control form-control-sm', placeholder = 'DD/MM/AAAA', disabled, style }) {
  const pickerRef = useRef()
  const [text, setText] = useState('')

  useEffect(() => {
    setText(value ? value.split('-').reverse().join('/') : '')
  }, [value])

  const tryCommit = raw => {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 8) {
      const iso = `${digits.slice(4,8)}-${digits.slice(2,4)}-${digits.slice(0,2)}`
      if (!isNaN(new Date(iso + 'T00:00:00'))) { onChange(iso); return }
    }
    if (!raw.trim()) onChange('')
  }

  const handleChange = e => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 8)
    let v = digits
    if (digits.length > 4) v = digits.slice(0,2) + '/' + digits.slice(2,4) + '/' + digits.slice(4)
    else if (digits.length > 2) v = digits.slice(0,2) + '/' + digits.slice(2)
    setText(v)
    tryCommit(v)
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: '100%', ...style }}>
      <input type="text" className={className} value={text}
        onChange={handleChange} onBlur={() => tryCommit(text)}
        placeholder={placeholder} maxLength={10} disabled={disabled}
        style={{ paddingRight: '1.8rem' }} />
      <input type="date" ref={pickerRef} tabIndex={-1} value={value || ''}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1, right: 24, top: 4, pointerEvents: 'none' }}
        onChange={e => onChange(e.target.value)} />
      <button type="button" tabIndex={-1} disabled={disabled}
        onClick={() => pickerRef.current?.showPicker?.()}
        style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer', padding: '0 2px', lineHeight: 1 }}>
        <i className="bi bi-calendar3" style={{ fontSize: '0.78rem', color: '#6c757d' }} />
      </button>
    </div>
  )
}
