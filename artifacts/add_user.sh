#!/bin/bash
# this script adds a user to sogo

### FUNCTIONS ###
function validate_mail() {
   username=$1
   echo $username| egrep -iq '([[:alnum:]_.]+@[[:alnum:]_]+?\.[[:alpha:].]{2,6})'; RC=$?
   if [ ${RC} -ne 0 ]
      then
      echo "Invalid username, please ensure user@domain.tld format ($RC)"
      exit 1
   fi
}

function get_username() {
   echo -n "Username <user@domain.com>: "
   read username
   validate_username ${username}
}

function get_password() {
   randpw=$(mkpasswd -l 15 -d 3 -C 5)
   echo 
   echo "Password suggestion: ${randpw}"
   echo
   echo -n "Password: "
   read password1
   echo -n "Password (again): "
   read password2

   if [ "${password1}" != "${password2}" ]
   then
      echo "Passwords miss-match, retry"
      get_password
   fi
}

function gen_ssha512() {
   #local password=$1
   doveadm pw -s SSHA512 -p "$password"
}

function gen_crammd5() {
   #local password=$1
   doveadm pw -s CRAM-MD5 -p "$password" | sed 's/{CRAM-MD5}//'
}

function check_dovecot_user() {
   grep -iq $username $USERSFILE; RC=$?
   if [ "${RC}" -eq 0 ]
   then
      echo "User already exists in $USERSFILE, please check."
      echo "For reference, or manual editing here was the computed string to use"
      echo "${username}:${password}"
      exit 1
   fi
}

function check_postfix_maps() {
   grep -iq $username $POSTFIXVIRTUAL_MAILBOX; RC=$?
   if [ "${RC}" -eq 0 ]
   then
      echo "User already exists in $POSTFIXVIRTUAL_MAILBOX, please check."
      echo "For reference, or manual editing here was the computed string to use"
      echo 
      echo "${username} OK"
      echo
      echo "You will also need to run 'postmap hash:$POSTFIXVIRTUAL_MAILBOX' if you edit this file directly"
      exit 1
   fi
}

function update_postfix_virtual() {
   local domain=`echo $username|cut -d@ -f2`
   grep -iq $domain $POSTFIXVIRTUAL_DOMAINS; RC=$?

   # Add the domain if we don't find it in grep
   if [ "${RC}" -ne 0 ]
   then
      echo "${domain}" >> $POSTFIXVIRTUAL_DOMAINS
      fi
}


### MAIN ###
read -r -p "ADD USERNAME: " username
read -r -p "ADD PASSWORD: " password
read -r -p "FULL NAME: " name
#mail_uuid=30016
#read -r -p "MAIL UUID: " mail_uuid
#read -r -p "ACCOUNT E-MAIL: " email
fqhn=localhost

#get_username
#get_password
#password=$(gen_ssha512)
#check_dovecot_user
#check_postfix_maps
#update_postfix_virtual
#echo "${username}:${password}" >> $USERSFILE
#echo "${username} OK" >> $POSTFIXVIRTUAL_MAILBOX
#postmap hash:$POSTFIXVIRTUAL_MAILBOX
#service postfix reload
#echo "Done"

echo "insert SOGo user in DB..."
output=$(mysql -usogo --password=password <<EOF
USE sogo;
INSERT INTO sogo_view VALUES ('$username', '$username', MD5('$password'), '$name', '$username@$fqhn');
EOF)

echo "$output"
echo "press enter..."
read

# UPDATE sogo_view SET c_password=MD5('password') WHERE c_uid=USERNAME';


exit

echo "insert IMAP user in DB..."
# generate password with "doveadm pw -s CRAM-MD5 -p <password>"
password_cram_md5=$(gen_crammd5)
echo $password_cram_md5
output=`mysql -umail --password=ar75xc13 <<EOD
USE mail;
INSERT INTO dovecot_user VALUES (NULL, '5000', '$name', '$username@$fqhn', '/var/mail/$fqhn/$username', '1');
EOD`
echo "$output"

#
# mail_uuid erzeugen
#
output=$(mysql mail -umail --password=ar75xc13<<<"SELECT MAX(\`uuid\`) AS uuid FROM dovecot_user")
#mail_uuid=$((${output#uuid}+1))
mail_uuid=${output#uuid}
echo $mail_uuid
echo "press enter..."
read

echo "insert IMAP password in DB..."
output=`mysql -umail --password=ar75xc13 <<EOD
USE mail;
INSERT INTO dovecot_passwd VALUES ($mail_uuid, 'PLAIN', '{PLAIN}$password');
INSERT INTO dovecot_passwd VALUES ($mail_uuid, 'SHA1', SHA1('$password'));
INSERT INTO dovecot_passwd VALUES ($mail_uuid, 'CRAM-MD5', '$password_cram_md5');
EOD`
echo "$output"
#echo "press enter..."
#read

#echo "add user to samba4..."
#sudo samba-tool domain passwordsettings set --complexity=off
#sudo samba-tool domain passwordsettings set --min-pwd-length=1
#sudo samba-tool user add $username $password
#sudo samba-tool user setexpiry $username --noexpiry
#echo "press enter..."
#read

#echo "create user in openchange..."
#sudo openchange_newuser --create $username
