"""URL routing for the console REST API.

Explicit ``path()`` entries (the contract doesn't fit a router/ViewSet shape),
grouped by resource into separate lists that concatenate into ``urlpatterns``.
Mounted at the site root in ``backend/urls.py``; single-segment ``<str:name>``
never swallows the ``.../runs`` etc. sub-paths, and none collide with the
existing exact ``mcp`` JSON-RPC gateway route.
"""

from __future__ import annotations

from django.urls import path

from . import views

health_urls = [
    path("health", views.HealthView.as_view()),
    path("health/recheck", views.HealthRecheckView.as_view()),
]

service_urls = [
    path("services", views.ServicesView.as_view()),
    path("services/<str:name>", views.ServiceDetailView.as_view()),
    path("services/<str:name>/runs", views.ServiceRunsView.as_view()),
    path("services/<str:name>/safety", views.ServiceSafetyView.as_view()),
    path("services/<str:name>/status", views.ServiceStatusView.as_view()),
    path("services/<str:name>/test", views.ServiceTestView.as_view()),
    path("services/<str:name>/discover", views.ServiceDiscoverView.as_view()),
    path("services/<str:name>/approve", views.ServiceApproveView.as_view()),
    path("services/<str:name>/sync", views.ServiceSyncView.as_view()),
]

sync_urls = [
    path("sync/run", views.SyncRunAllView.as_view()),
    path("sync/schedules", views.SyncSchedulesView.as_view()),
    path("sync/status", views.SyncStatusView.as_view()),
    path("sync/history", views.SyncHistoryView.as_view()),
]

mcp_urls = [
    path("mcp/status", views.McpStatusView.as_view()),
    path("mcp/tools", views.McpToolsView.as_view()),
    path("mcp/toolsets", views.McpToolsetsView.as_view()),
    path("mcp/sources", views.McpSourcesView.as_view()),
    path("mcp/validate", views.McpValidateView.as_view()),
    path("mcp/build", views.McpBuildView.as_view()),
    path("mcp/test/<str:tool>", views.McpTestView.as_view()),
]

misc_urls = [
    path("roles", views.RolesView.as_view()),
    path("counts", views.CountsView.as_view()),
    path("reset", views.ResetView.as_view()),
]

urlpatterns = health_urls + service_urls + sync_urls + mcp_urls + misc_urls
