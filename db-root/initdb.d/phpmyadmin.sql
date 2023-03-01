CREATE USER 'phpmyadmin'@'%' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON * . * TO 'phpmyadmin'@'%';
FLUSH PRIVILEGES;
