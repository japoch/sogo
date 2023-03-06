USE sogo;
CREATE TABLE `sogo_view` (
  `c_uid` varchar(128) NOT NULL COMMENT 'c_uid: will be used for authentication - it’s a username or username@domain.tld',
  `c_name` varchar(128) NOT NULL COMMENT 'c_name: will be used to uniquely identify entries - which can be identical to c_uid',
  `c_password` varchar(128) NOT NULL COMMENT 'c_password: password of the user, plain text, crypt, md5 or sha encoded',
  `c_cn` varchar(128) DEFAULT NULL COMMENT 'c_cn: the user’s common name',
  `mail` varchar(128) NOT NULL COMMENT 'mail: the user’s email address',
  PRIMARY KEY (`c_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
