"""Company report profiles for the global print dialog.

Every "Print" button in the application opens a dialog that lists the company
report profiles and prints the report with the chosen branding. The Company
Report Profile Master *View* permission is an administrative permission, so the
print dialog must not depend on it - otherwise operators (who print the reports)
would see an empty dialog.
"""

from app.models import CompanyReportProfile
from app.utils.jwt import create_access_token
from tests.conftest import create_user


def _profile(
    profile_name,
    company_name,
    status="Active",
):
    return CompanyReportProfile(
        profile_name=profile_name,
        company_name=company_name,
        system_name="Hydrocarbon Accounting System",
        report_subtitle="Tank Gauging Quantity Report",
        logo_data_url="",
        logo_text="LOGO",
        footer_formula="Formula: GOV = TOV - Free Water",
        footer_note="This report is system-generated.",
        status=status,
    )


def _auth_headers(user):
    token = create_access_token(
        {"user_id": user.id, "username": user.username}
    )
    return {"Authorization": f"Bearer {token}"}


def test_print_options_require_login(client):
    response = client.get("/company-report-profiles/print-options")

    assert response.status_code in (401, 403)


def test_print_options_are_available_without_the_master_view_permission(client, db):
    """A user with no Company Report Profile permission can still print."""
    operator = create_user(db, "print_operator")
    db.add_all(
        [
            _profile("Beta Energy", "Beta Energy Ltd"),
            _profile("Acme Petroleum", "Acme Petroleum Ltd"),
            _profile("Archived Profile", "Old Co", status="Inactive"),
        ]
    )
    db.commit()

    response = client.get(
        "/company-report-profiles/print-options",
        headers=_auth_headers(operator),
    )

    assert response.status_code == 200
    rows = response.json()
    assert [row["profile_name"] for row in rows] == [
        "Acme Petroleum",
        "Beta Energy",
        "Archived Profile",
    ]
    # The dialog needs the full branding to render the report header.
    assert rows[0]["company_name"] == "Acme Petroleum Ltd"
    assert rows[0]["footer_formula"] == "Formula: GOV = TOV - Free Water"
    # Active profiles are offered first.
    assert rows[-1]["status"] == "Inactive"


def test_print_options_see_profiles_created_by_another_user(client, db):
    """Profiles are global: one user's addition is visible to every user."""
    create_user(db, "profile_author")
    operator = create_user(db, "second_operator")
    # The master page writes the row with the same model; another signed-in
    # user must still see it in their print dialog.
    db.add(_profile("Shared Profile", "Shared Company Ltd"))
    db.commit()

    response = client.get(
        "/company-report-profiles/print-options",
        headers=_auth_headers(operator),
    )

    assert response.status_code == 200
    assert [row["profile_name"] for row in response.json()] == ["Shared Profile"]
    # The Company Report Profile Master listing stays permission-protected.
    assert client.get(
        "/company-report-profiles",
        headers=_auth_headers(operator),
    ).status_code == 403
