output "github_actions_role_arn" {
  description = "GitHub Actions IAM 역할 ARN"
  value       = aws_iam_role.github_actions.arn
}

output "ebs_csi_driver_role_arn" {
  description = "EBS CSI 드라이버 IAM 역할 ARN"
  value       = aws_iam_role.ebs_csi_driver.arn
}
