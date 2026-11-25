import { Component } from 'react'
import { Link } from 'react-router-dom'
import AlertMessage from '../common/AlertMessage'

class AnalyticsErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error, info) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('Analytics module render error:', error, info)
    }
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <div className="analytics-page" style={{ padding: '24px' }}>
          <AlertMessage
            tone="error"
            title="Unable to render Analytics view"
            message={error?.message || 'An unexpected error occurred while rendering this Analytics dashboard.'}
          />
          <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => this.setState({ error: null })}
            >
              Try Again
            </button>
            <Link to="/analytics" className="btn-secondary">
              Back to Analytics Hub
            </Link>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default AnalyticsErrorBoundary
