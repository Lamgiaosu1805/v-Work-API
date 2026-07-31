import UserInfoModel from "../../../models/UserInfoModel";
import { notify } from "../../../helpers/requestUtils";
import { getApprovalChain } from "../domain/approval-chain";
import { getAccountsWithPermission } from "../../../helpers/rbac";
import { TYPE_LABELS } from "../domain/request-type-labels";
import { PERMISSION } from "../../../constants";
import { eventBus } from "../../../core/events/event-bus";
import { RequestCreatedDomainEvent } from "../domain/events/request-created.domain-event";
import { RequestPartiallyApprovedDomainEvent } from "../domain/events/request-partially-approved.domain-event";
import { RequestApprovedDomainEvent } from "../domain/events/request-approved.domain-event";
import { RequestRejectedDomainEvent } from "../domain/events/request-rejected.domain-event";

async function onRequestCreated(event: RequestCreatedDomainEvent): Promise<void> {
  const [userInfo, chain] = await Promise.all([
    UserInfoModel.findById(event.userId).select("full_name"),
    getApprovalChain(event.userId)
  ]);
  const nearest = chain[0];
  if (!userInfo || !nearest) return;

  await notify(nearest.accountId, {
    title: "Đơn xin phép mới",
    body: `${userInfo.full_name} gửi đơn ${TYPE_LABELS[event.requestType]}`,
    type: `${event.requestType}_created`,
    ref_id: event.aggregateId,
    ref_type: "request",
    uri: `/requests/${event.aggregateId}`
  });
}

async function onRequestPartiallyApproved(
  event: RequestPartiallyApprovedDomainEvent
): Promise<void> {
  const [employeeInfo, reviewerInfo] = await Promise.all([
    UserInfoModel.findById(event.userId).select("id_account full_name"),
    UserInfoModel.findById(event.reviewerId).select("id_account full_name")
  ]);
  if (!employeeInfo || !reviewerInfo) return;
  if (String(employeeInfo.id_account) === String(reviewerInfo.id_account)) return;

  const label = TYPE_LABELS[event.requestType];
  await notify(employeeInfo.id_account, {
    title: "Đơn đã được duyệt bước 1/2",
    body: `Đơn ${label} của bạn đã được ${reviewerInfo.full_name} duyệt (1/2), đang chờ người duyệt tiếp theo`,
    type: "leave_partially_approved",
    ref_id: event.aggregateId,
    ref_type: "request",
    uri: `/requests/${event.aggregateId}`
  });
}

interface FinalDecisionOptions {
  action: "approve" | "reject";
  hadPriorApproval: boolean;
  reviewerNote: string;
}

async function notifyFinalDecision(
  event: RequestApprovedDomainEvent | RequestRejectedDomainEvent,
  { action, hadPriorApproval, reviewerNote }: FinalDecisionOptions
): Promise<void> {
  const [employeeInfo, reviewerInfo, hrAccountIds] = await Promise.all([
    UserInfoModel.findById(event.userId).select("id_account full_name"),
    UserInfoModel.findById(event.reviewerId).select("id_account full_name"),
    getAccountsWithPermission(PERMISSION.HRM_REQUEST_VIEW_ALL)
  ]);
  if (!employeeInfo || !reviewerInfo) return;

  const label = TYPE_LABELS[event.requestType];
  const employeeAccountId = String(employeeInfo.id_account);
  const reviewerAccountId = String(reviewerInfo.id_account);
  const title = action === "approve" ? "Đơn được duyệt" : "Đơn bị từ chối";
  const type =
    action === "approve" ? `${event.requestType}_approved` : `${event.requestType}_rejected`;
  const rejectSuffix = reviewerNote ? `: ${reviewerNote}` : "";

  let employeeBody: string;
  if (action === "approve") {
    employeeBody = `Đơn ${label} của bạn đã được ${reviewerInfo.full_name} duyệt`;
  } else if (hadPriorApproval) {
    employeeBody = `Đơn ${label} của bạn đã được duyệt 1 phần trước đó, nhưng bị ${reviewerInfo.full_name} từ chối${rejectSuffix}`;
  } else {
    employeeBody = `Đơn ${label} của bạn đã bị ${reviewerInfo.full_name} từ chối${rejectSuffix}`;
  }

  const notifications: Promise<unknown>[] = [];
  if (employeeAccountId !== reviewerAccountId) {
    notifications.push(
      notify(employeeInfo.id_account, {
        title,
        body: employeeBody,
        type,
        ref_id: event.aggregateId,
        ref_type: "request",
        uri: `/requests/${event.aggregateId}`
      })
    );
  }

  const nearestChain = await getApprovalChain(event.userId);
  const broadcastIds = new Set(hrAccountIds.map((accId: unknown) => String(accId)));
  if (nearestChain[0]) broadcastIds.add(String(nearestChain[0].accountId));
  broadcastIds.delete(reviewerAccountId);
  broadcastIds.delete(employeeAccountId);

  let broadcastBody: string;
  if (action === "approve") {
    broadcastBody = `Đơn ${label} của ${employeeInfo.full_name} đã được ${reviewerInfo.full_name} duyệt`;
  } else if (hadPriorApproval) {
    broadcastBody = `Đơn ${label} của ${employeeInfo.full_name} đã được duyệt 1 phần trước đó, nhưng bị ${reviewerInfo.full_name} từ chối${rejectSuffix}`;
  } else {
    broadcastBody = `Đơn ${label} của ${employeeInfo.full_name} đã bị ${reviewerInfo.full_name} từ chối${rejectSuffix}`;
  }

  broadcastIds.forEach((accountId) => {
    notifications.push(
      notify(accountId, {
        title,
        body: broadcastBody,
        type,
        ref_id: event.aggregateId,
        ref_type: "request",
        uri: `/requests/${event.aggregateId}`
      })
    );
  });

  await Promise.all(notifications);
}

async function onRequestApproved(event: RequestApprovedDomainEvent): Promise<void> {
  await notifyFinalDecision(event, {
    action: "approve",
    hadPriorApproval: false,
    reviewerNote: ""
  });
}

async function onRequestRejected(event: RequestRejectedDomainEvent): Promise<void> {
  await notifyFinalDecision(event, {
    action: "reject",
    hadPriorApproval: event.overriddenApprovals.length > 0,
    reviewerNote: event.reviewerNote ?? ""
  });
}

eventBus.on(RequestCreatedDomainEvent.name, onRequestCreated);
eventBus.on(RequestPartiallyApprovedDomainEvent.name, onRequestPartiallyApproved);
eventBus.on(RequestApprovedDomainEvent.name, onRequestApproved);
eventBus.on(RequestRejectedDomainEvent.name, onRequestRejected);

export { onRequestCreated, onRequestPartiallyApproved, onRequestApproved, onRequestRejected };
