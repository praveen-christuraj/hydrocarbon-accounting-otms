/**
 * Standard page header.
 *
 *   <PageHeader
 *     title="Location Master"
 *     description="Create, update, and manage operational locations."
 *     count={`${locations.length} Locations`}
 *     actions={<button type="button">New Location</button>}
 *   />
 */
function PageHeader({ title, description, count, actions, children, className = '' }) {
  return (
    <div className={`page-title ${className}`.trim()}>
      <div className="page-title-text">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        {children}
      </div>

      {(count || actions) && (
        <div className="page-title-actions">
          {actions}
          {count && <span className="record-count">{count}</span>}
        </div>
      )}
    </div>
  )
}

export default PageHeader
