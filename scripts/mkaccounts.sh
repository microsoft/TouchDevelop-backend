#!/bin/sh

c=""
echo -n > envadd.json

pref=myservice

function addone() {
  name=$pref$1
  v0=$3
  v1=$2
  azure storage account create --type RAGRS --location "East US" $name
  key=`azure storage account keys list $name --json | grep primaryKey | sed -e 's/.*: "//; s/",//g'`
  echo "\"$v0\": \"$name\"," >> envadd.json
  echo "\"$v1\": \"$key\"," >> envadd.json
  cat envadd.json
  echo "\"$name\": \"$key\"," >> accounts.json
}


addone "" AZURE_STORAGE_ACCESS_KEY AZURE_STORAGE_ACCOUNT &
addone backup BACKUP_KEY BACKUP_ACCOUNT &
#addone compile COMPILE_KEY COMPILE_ACCOUNT &
addone ws0 WORKSPACE_BLOB_KEY0 WORKSPACE_BLOB_ACCOUNT0 &
addone ws1 WORKSPACE_BLOB_KEY1 WORKSPACE_BLOB_ACCOUNT1 &
addone ws2 WORKSPACE_BLOB_KEY2 WORKSPACE_BLOB_ACCOUNT2 &
addone ws3 WORKSPACE_BLOB_KEY3 WORKSPACE_BLOB_ACCOUNT3 &
addone wstab WORKSPACE_KEY WORKSPACE_ACCOUNT &
addone hist WORKSPACE_HIST_KEY WORKSPACE_HIST_ACCOUNT &
addone not NOTIFICATIONS_KEY NOTIFICATIONS_ACCOUNT &
addone audit AUDIT_BLOB_KEY AUDIT_BLOB_ACCOUNT &
addone streams STREAMS_KEY STREAMS_ACCOUNT &
